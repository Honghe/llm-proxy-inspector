"""
LLM Proxy — OpenAI-compatible reverse proxy with request/response inspector
============================================================================
用法:
  pip install fastapi uvicorn httpx
  python proxy.py
  python proxy.py --upstream http://127.0.0.1:8000 --proxy-port 7654 --ui-port 7655 --max-records 200
"""

import argparse
import asyncio
import copy
import hashlib
import json
import logging
import os
import sqlite3
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

# ── 配置 ──────────────────────────────────────────────────────────────────────
_parser = argparse.ArgumentParser(description="LLM Proxy Inspector")
_parser.add_argument("--upstream", default=os.getenv("UPSTREAM_BASE", "http://127.0.0.1:8000"))
_parser.add_argument("--proxy-port", type=int, default=int(os.getenv("PROXY_PORT", "7654")))
_parser.add_argument("--ui-port", type=int, default=int(os.getenv("UI_PORT", "7655")))
_parser.add_argument("--max-records", type=int, default=int(os.getenv("MAX_RECORDS", "200")))
_parser.add_argument("--db-path", default=os.getenv("DB_PATH", "data/proxy.db"))
_args = _parser.parse_args()

UPSTREAM_BASE = _args.upstream.rstrip("/")
PROXY_PORT = _args.proxy_port
UI_PORT = _args.ui_port
MAX_RECORDS = _args.max_records
DB_PATH = Path(_args.db_path)
# ──────────────────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("proxy")


def db_connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


DB = db_connect()


def init_db() -> None:
    DB.execute(
        """
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            time TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            model TEXT,
            stream INTEGER NOT NULL DEFAULT 0,
            status INTEGER,
            latency INTEGER,
            is_sse INTEGER NOT NULL DEFAULT 0,
            req_json TEXT,
            resp_json TEXT,
            resp_merged TEXT,
            resp_raw TEXT,
            sse_lines TEXT,
            req_messages_sig TEXT,
            req_messages_count INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    DB.execute("CREATE INDEX IF NOT EXISTS idx_records_session_created ON records(session_id, created_at)")
    DB.execute("CREATE INDEX IF NOT EXISTS idx_records_created ON records(created_at)")
    DB.commit()


init_db()


def dumps_json(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def loads_json(value: str | None) -> Any:
    if not value:
        return None
    return json.loads(value)


# ── SSE 解析 ──────────────────────────────────────────────────────────────────

def _merge_delta(acc: dict, delta: dict) -> None:
    for key, val in delta.items():
        if val is None:
            continue
        if key not in acc or acc[key] is None:
            acc[key] = copy.deepcopy(val)
        elif isinstance(val, str) and isinstance(acc[key], str) and key in ("content", "reasoning_content", "arguments"):
            acc[key] += val
        elif isinstance(val, list) and isinstance(acc[key], list):
            for item in val:
                if not isinstance(item, dict):
                    acc[key].append(item)
                    continue
                item_idx = item.get("index")
                existing = (
                    next((x for x in acc[key] if isinstance(x, dict) and x.get("index") == item_idx), None)
                    if item_idx is not None
                    else None
                )
                if existing is None:
                    acc[key].append(copy.deepcopy(item))
                else:
                    _merge_delta(existing, item)
        elif isinstance(val, dict) and isinstance(acc[key], dict):
            _merge_delta(acc[key], val)
        else:
            if type(acc[key]) is not type(val):
                log.warning(
                    "merge type mismatch key=%r acc=%r val=%r, overwriting",
                    key,
                    type(acc[key]).__name__,
                    type(val).__name__,
                )
            acc[key] = val


def parse_sse_lines(lines: list[str]) -> dict:
    chunks: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        try:
            chunks.append(json.loads(payload))
        except json.JSONDecodeError:
            pass

    if not chunks:
        return {}

    first = chunks[0]
    result: dict = {
        "id": first.get("id"),
        "object": "chat.completion",
        "created": first.get("created"),
        "model": first.get("model"),
        "usage": None,
    }

    choices_acc: dict[int, dict] = {}
    for chunk in chunks:
        if chunk.get("usage"):
            result["usage"] = chunk["usage"]

        for choice in chunk.get("choices", []):
            idx = choice.get("index", 0)
            if idx not in choices_acc:
                choices_acc[idx] = {"index": idx, "finish_reason": None}
            _merge_delta(choices_acc[idx], choice.get("delta", {}))
            top = {k: v for k, v in choice.items() if k not in ("delta", "index") and v is not None}
            _merge_delta(choices_acc[idx], top)

    result["choices"] = [choices_acc[i] for i in sorted(choices_acc)]
    return result


def get_messages(req_json: Any) -> list[dict]:
    if isinstance(req_json, dict) and isinstance(req_json.get("messages"), list):
        return [m for m in req_json["messages"] if isinstance(m, dict)]
    return []


def _session_hint(req_json: Any, headers: dict[str, str]) -> str | None:
    lowered = {k.lower(): v for k, v in headers.items()}
    for key in ("x-session-id", "x-conversation-id", "x-thread-id"):
        if lowered.get(key):
            return lowered[key]

    if not isinstance(req_json, dict):
        return None

    for key in ("session_id", "conversation_id", "thread_id"):
        value = req_json.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    metadata = req_json.get("metadata")
    if isinstance(metadata, dict):
        for key in ("session_id", "conversation_id", "thread_id"):
            value = metadata.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _messages_sig(messages: list[dict]) -> str | None:
    if not messages:
        return None
    encoded = json.dumps(messages, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha1(encoded.encode("utf-8")).hexdigest()


def _is_prefix_messages(previous: list[dict], current: list[dict]) -> bool:
    if not previous or len(previous) > len(current):
        return False
    return previous == current[: len(previous)]


def resolve_session_id(path: str, model: str, req_json: Any, headers: dict[str, str]) -> tuple[str, str | None, int]:
    hinted = _session_hint(req_json, headers)
    messages = get_messages(req_json)
    messages_count = len(messages)
    messages_sig = _messages_sig(messages)

    if hinted:
        return hinted, messages_sig, messages_count

    if messages:
        rows = DB.execute(
            """
            SELECT session_id, req_json
            FROM records
            WHERE path = ? AND model = ?
            ORDER BY created_at DESC
            LIMIT 50
            """,
            (path, model),
        ).fetchall()
        for row in rows:
            prev_json = loads_json(row["req_json"])
            prev_messages = get_messages(prev_json)
            if _is_prefix_messages(prev_messages, messages) or prev_messages == messages:
                return row["session_id"], messages_sig, messages_count

    return str(uuid.uuid4()), messages_sig, messages_count


def save_record(data: dict[str, Any]) -> None:
    DB.execute(
        """
        INSERT OR REPLACE INTO records (
            id, session_id, created_at, time, method, path, model, stream, status, latency, is_sse,
            req_json, resp_json, resp_merged, resp_raw, sse_lines, req_messages_sig, req_messages_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            data["id"],
            data["session_id"],
            data["created_at"],
            data["time"],
            data["method"],
            data["path"],
            data.get("model"),
            int(bool(data.get("stream"))),
            data.get("status"),
            data.get("latency"),
            int(bool(data.get("is_sse"))),
            dumps_json(data.get("req_json")),
            dumps_json(data.get("resp_json")),
            dumps_json(data.get("resp_merged")),
            data.get("resp_raw"),
            dumps_json(data.get("sse_lines")),
            data.get("req_messages_sig"),
            data.get("req_messages_count", 0),
        ),
    )
    DB.commit()

    DB.execute(
        """
        DELETE FROM records
        WHERE id IN (
            SELECT id
            FROM records
            ORDER BY created_at DESC
            LIMIT -1 OFFSET ?
        )
        """,
        (MAX_RECORDS,),
    )
    DB.commit()


def update_record(record_id: str, **updates: Any) -> None:
    current = get_record(record_id)
    if not current:
        return
    current.update(updates)
    save_record(current)


def row_to_record(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "session_id": row["session_id"],
        "created_at": row["created_at"],
        "time": row["time"],
        "method": row["method"],
        "path": row["path"],
        "model": row["model"] or "",
        "stream": bool(row["stream"]),
        "status": row["status"],
        "latency": row["latency"],
        "is_sse": bool(row["is_sse"]),
        "req_json": loads_json(row["req_json"]),
        "resp_json": loads_json(row["resp_json"]),
        "resp_merged": loads_json(row["resp_merged"]),
        "resp_raw": row["resp_raw"],
        "sse_lines": loads_json(row["sse_lines"]),
        "req_messages_sig": row["req_messages_sig"],
        "req_messages_count": row["req_messages_count"],
    }


def get_record(record_id: str) -> dict[str, Any] | None:
    row = DB.execute("SELECT * FROM records WHERE id = ?", (record_id,)).fetchone()
    return row_to_record(row)


def get_session_records(session_id: str) -> list[dict[str, Any]]:
    rows = DB.execute(
        "SELECT * FROM records WHERE session_id = ? ORDER BY created_at ASC",
        (session_id,),
    ).fetchall()
    records = []
    for row in rows:
        record = row_to_record(row)
        if record is not None:
            records.append(record)
    return records


def summarize_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": record["id"],
        "session_id": record["session_id"],
        "time": record["time"],
        "method": record["method"],
        "path": record["path"],
        "model": record.get("model", ""),
        "stream": record.get("stream", False),
        "status": record.get("status"),
        "latency": record.get("latency"),
        "is_sse": record.get("is_sse", False),
        "done": record.get("status") is not None,
    }


def summarize_session(records: list[dict[str, Any]]) -> dict[str, Any]:
    first = records[0]
    last = records[-1]
    return {
        "id": first["session_id"],
        "created_at": first["created_at"],
        "last_created_at": last["created_at"],
        "record_count": len(records),
        "time": first["time"],
        "last_time": last["time"],
        "method": last["method"],
        "path": last["path"],
        "model": last.get("model", ""),
        "status": last.get("status"),
        "latency": last.get("latency"),
        "is_sse": any(r.get("is_sse") for r in records),
        "done": all(r.get("status") is not None for r in records),
        "last_record_id": last["id"],
        "preview": build_session_preview(records),
    }


def build_session_preview(records: list[dict[str, Any]]) -> str:
    for record in reversed(records):
        messages = get_messages(record.get("req_json"))
        if messages:
            last = messages[-1]
            content = last.get("content")
            if isinstance(content, str) and content.strip():
                return content.strip()[:120]
            if isinstance(content, list):
                text_parts = [item.get("text", "") for item in content if isinstance(item, dict) and item.get("type") == "text"]
                joined = " ".join(part for part in text_parts if part).strip()
                if joined:
                    return joined[:120]
    return ""


def list_sessions() -> list[dict[str, Any]]:
    rows = DB.execute("SELECT DISTINCT session_id FROM records").fetchall()
    sessions = []
    for row in rows:
        records = get_session_records(row["session_id"])
        if records:
            sessions.append(summarize_session(records))
    sessions.sort(key=lambda item: item["last_created_at"], reverse=True)
    return sessions


# ── Proxy App ─────────────────────────────────────────────────────────────────

proxy_app = FastAPI(title="LLM Proxy")


@proxy_app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy(path: str, request: Request):
    url = f"{UPSTREAM_BASE}/{path}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")}

    body_bytes = await request.body()
    try:
        req_json = json.loads(body_bytes) if body_bytes else None
    except Exception:
        req_json = None

    is_stream = isinstance(req_json, dict) and req_json.get("stream", False)
    record_id = str(uuid.uuid4())
    session_id, req_messages_sig, req_messages_count = resolve_session_id(f"/{path}", req_json.get("model", "") if isinstance(req_json, dict) else "", req_json, headers)
    now = datetime.now()
    base_record = {
        "id": record_id,
        "session_id": session_id,
        "created_at": int(now.timestamp() * 1000),
        "time": now.strftime("%H:%M:%S"),
        "method": request.method,
        "path": f"/{path}",
        "model": req_json.get("model", "") if isinstance(req_json, dict) else "",
        "stream": is_stream,
        "req_json": req_json,
        "status": None,
        "latency": None,
        "is_sse": False,
        "resp_json": None,
        "resp_merged": None,
        "resp_raw": None,
        "sse_lines": None,
        "req_messages_sig": req_messages_sig,
        "req_messages_count": req_messages_count,
    }
    save_record(base_record)

    t0 = time.monotonic()
    log.info("→ %s %s  model=%s  stream=%s  session=%s", request.method, url, base_record["model"] or "-", is_stream, session_id[:8])

    if is_stream:
        async def stream_gen() -> AsyncIterator[bytes]:
            sse_lines: list[str] = []
            status_code = 200
            async with httpx.AsyncClient(timeout=300) as stream_client:
                try:
                    async with stream_client.stream(
                        request.method,
                        url,
                        headers=headers,
                        content=body_bytes,
                    ) as upstream:
                        status_code = upstream.status_code
                        log.info("← %s %s  status=%s  [SSE started]", request.method, url, status_code)
                        async for raw_line in upstream.aiter_lines():
                            sse_lines.append(raw_line)
                            yield (raw_line + "\n").encode()
                except Exception as exc:
                    log.error("✗ %s %s  error=%s", request.method, url, exc)
                    yield f"data: [ERROR] {exc}\n\n".encode()
                finally:
                    latency = round((time.monotonic() - t0) * 1000)
                    merged = parse_sse_lines(sse_lines)
                    log.info(
                        "← %s %s  status=%s  %dms  [SSE done, chunks=%d]",
                        request.method,
                        url,
                        status_code,
                        latency,
                        len(sse_lines),
                    )
                    update_record(
                        record_id,
                        status=status_code,
                        latency=latency,
                        is_sse=True,
                        resp_merged=merged,
                        sse_lines=sse_lines,
                    )

        return StreamingResponse(
            stream_gen(),
            media_type="text/event-stream",
            headers={
                "X-Proxy-Record-Id": record_id,
                "X-Proxy-Session-Id": session_id,
            },
        )

    async with httpx.AsyncClient(timeout=300) as client:
        try:
            resp = await client.request(request.method, url, headers=headers, content=body_bytes)
        except Exception as exc:
            log.error("✗ %s %s  error=%s", request.method, url, exc)
            raise
        latency = round((time.monotonic() - t0) * 1000)
        log.info("← %s %s  status=%s  %dms", request.method, url, resp.status_code, latency)
        try:
            resp_json = resp.json()
        except Exception:
            resp_json = None

        update_record(
            record_id,
            status=resp.status_code,
            latency=latency,
            is_sse=False,
            resp_json=resp_json,
            resp_raw=resp.text if resp_json is None else None,
        )

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers={
                **dict(resp.headers),
                "X-Proxy-Record-Id": record_id,
                "X-Proxy-Session-Id": session_id,
            },
            media_type=resp.headers.get("content-type"),
        )


# ── UI App ────────────────────────────────────────────────────────────────────

ui_app = FastAPI(title="LLM Proxy UI")


@ui_app.get("/api/records")
def api_records():
    rows = DB.execute("SELECT * FROM records ORDER BY created_at DESC").fetchall()
    return [summarize_record(row_to_record(row)) for row in rows]


@ui_app.get("/api/sessions")
def api_sessions():
    return list_sessions()


@ui_app.get("/api/sessions/{session_id}")
def api_session_detail(session_id: str):
    records = get_session_records(session_id)
    if not records:
        return JSONResponse({"error": "not found"}, status_code=404)
    return {
        "session": summarize_session(records),
        "records": records,
    }


@ui_app.delete("/api/records")
def api_clear_records():
    DB.execute("DELETE FROM records")
    DB.commit()
    return {"cleared": True}


@ui_app.get("/api/records/{record_id}")
def api_record_detail(record_id: str):
    record = get_record(record_id)
    if not record:
        return JSONResponse({"error": "not found"}, status_code=404)
    return record


@ui_app.get("/ids/{record_id}")
@ui_app.get("/sessions/{session_id}")
@ui_app.get("/")
def index():
    return FileResponse("static/index.html")


ui_app.mount("/static", StaticFiles(directory="static"), name="static")


async def main():
    cfg_proxy = uvicorn.Config(proxy_app, host="0.0.0.0", port=PROXY_PORT, log_level="warning")
    cfg_ui = uvicorn.Config(ui_app, host="0.0.0.0", port=UI_PORT, log_level="warning")

    print(f"  Proxy  -> http://0.0.0.0:{PROXY_PORT}  (upstream: {UPSTREAM_BASE})")
    print(f"  UI     -> http://0.0.0.0:{UI_PORT}")
    print(f"  DB     -> {DB_PATH}")
    print()

    await asyncio.gather(
        uvicorn.Server(cfg_proxy).serve(),
        uvicorn.Server(cfg_ui).serve(),
    )


if __name__ == "__main__":
    asyncio.run(main())
