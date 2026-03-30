import { useMemo, useState } from "react";

import type { RecordItem, SessionSummary } from "../../shared/types/api";
import { ClearHistoryButton } from "../../features/clear-history/ClearHistoryButton";

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  activeRecords?: RecordItem[];
  activeRecordId?: string;
  onSelectSession: (sessionId: string) => void;
  onSelectRecord: (recordId: string) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  activeRecords = [],
  activeRecordId,
  onSelectSession,
  onSelectRecord,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [ipFilter, setIpFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "err" | "pending">("all");

  const filteredSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const statusClass =
          session.status == null
            ? "pending"
            : session.status < 400
              ? "ok"
              : "err";

        if (statusFilter !== "all" && statusClass !== statusFilter) {
          return false;
        }

        const normalizedPath = session.path.toLowerCase();
        const normalizedIp = String(session.client_ip || "").toLowerCase();
        const haystack = [
          session.path,
          session.preview || "",
          session.model || "",
          session.method,
          session.last_time,
          session.client_ip || "",
        ]
          .join(" ")
          .toLowerCase();

        if (query.trim() && !haystack.includes(query.trim().toLowerCase())) {
          return false;
        }
        if (pathFilter.trim() && !normalizedPath.includes(pathFilter.trim().toLowerCase())) {
          return false;
        }
        if (ipFilter.trim() && !normalizedIp.includes(ipFilter.trim().toLowerCase())) {
          return false;
        }
        return true;
      }),
    [ipFilter, pathFilter, query, sessions, statusFilter],
  );

  return (
    <aside id="sidebar">
      <div id="sidebar-head">
        <h1>
          <span className="dot" /> LLM Proxy Inspector
        </h1>
        <div id="sidebar-meta">
          <span id="count-badge">{sessions.length} 个会话</span>
          <ClearHistoryButton />
        </div>
        <div className="sidebar-filters">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="sidebar-filter-input"
            placeholder="搜索文本 / model / 方法"
          />
          <div className="sidebar-filter-row">
            <input
              value={pathFilter}
              onChange={(event) => setPathFilter(event.target.value)}
              className="sidebar-filter-input"
              placeholder="过滤 path"
            />
            <input
              value={ipFilter}
              onChange={(event) => setIpFilter(event.target.value)}
              className="sidebar-filter-input"
              placeholder="过滤 IP"
            />
          </div>
          <div className="sidebar-filter-row">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "ok" | "err" | "pending")}
              className="sidebar-filter-select"
            >
              <option value="all">全部状态</option>
              <option value="ok">成功</option>
              <option value="err">错误</option>
              <option value="pending">进行中</option>
            </select>
            <button
              type="button"
              className="sidebar-filter-clear"
              onClick={() => {
                setQuery("");
                setPathFilter("");
                setIpFilter("");
                setStatusFilter("all");
              }}
            >
              清空
            </button>
          </div>
        </div>
      </div>
      <div id="sidebar-list">
        {filteredSessions.length ? (
          filteredSessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const statusClass =
              session.status == null
                ? "pending"
                : session.status < 400
                  ? "ok"
                  : "err";
            const statusText = session.status == null ? "…" : session.status;
            const latencyText =
              session.latency != null ? ` · ${session.latency}ms` : "";

            return (
              <div key={session.id} className="record-group">
                <button
                  type="button"
                  className={`record-item ${isActive ? "active" : ""}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span className="ri-method">{session.record_count}</span>
                  <span className="ri-path">{session.path}</span>
                  <span className={`ri-status ${statusClass}`}>{statusText}</span>
                  <div className="ri-meta">
                    {session.model ? (
                      <span className="ri-model">
                        {session.model.split("/").pop()}
                      </span>
                    ) : null}
                    {session.is_sse ? <span className="ri-badge sse">SSE</span> : null}
                    {session.client_ip ? <span>{session.client_ip}</span> : null}
                    <span>
                      {session.last_time}
                      {latencyText}
                    </span>
                  </div>
                  {session.preview ? (
                    <div className="session-preview">{session.preview}</div>
                  ) : null}
                </button>

                {isActive && activeRecords.length > 1 ? (
                  <div className="record-turns">
                    {activeRecords.map((record, index) => {
                      const isRecordActive = record.id === activeRecordId;
                      const preview = getRecordPreview(record);

                      return (
                        <button
                          key={record.id}
                          type="button"
                          className={`record-turn-item ${isRecordActive ? "active" : ""}`}
                          onClick={() => onSelectRecord(record.id)}
                        >
                          <span className="record-turn-index">#{index + 1}</span>
                          <span className="record-turn-time">{record.time}</span>
                          <span className="record-turn-label">{preview}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="list-empty">
            {sessions.length ? "没有匹配的会话" : "等待请求…"}
          </div>
        )}
      </div>
    </aside>
  );
}

function getRecordPreview(record: RecordItem) {
  const reqJson = record.req_json || {};
  const messages = Array.isArray((reqJson as { messages?: Array<{ content?: unknown }> }).messages)
    ? (reqJson as { messages: Array<{ content?: unknown }> }).messages
    : [];

  const lastContent = messages[messages.length - 1]?.content;
  const preview = stringifyPreview(lastContent);

  return preview || record.path;
}

function stringifyPreview(content: unknown) {
  if (typeof content === "string") {
    return content.replace(/\s+/g, " ").trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          "type" in block &&
          (block as { type?: string }).type === "text"
        ) {
          return String((block as { text?: string }).text || "");
        }
        return "";
      })
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (content == null) {
    return "";
  }

  return String(content).replace(/\s+/g, " ").trim();
}
