import { useState } from "react";

import { copyText } from "../../shared/lib/clipboard";
import { formatUsage } from "../../shared/lib/format";
import type { Message, RecordItem, SessionDetail as SessionDetailData, ToolCall } from "../../shared/types/api";
import { getRecordUsage, normalizeResponseChoices } from "../../entities/record/normalize";

type TabKey = "pretty" | "raw-json" | "chunks";

interface SessionDetailProps {
  payload: SessionDetailData;
  selectedRecordId?: string;
}

export function SessionDetail({ payload, selectedRecordId }: SessionDetailProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("pretty");

  const records = payload.records || [];
  const session = payload.session;
  const last = records[records.length - 1] || null;
  const visibleRecords = selectedRecordId
    ? records.filter((record) => record.id === selectedRecordId)
    : last
      ? [last]
      : [];
  const hasSse = records.some((record) => record.is_sse);
  const usageText = formatUsage(getRecordUsage(last));

  const visibleTab = hasSse ? activeTab : activeTab === "chunks" ? "pretty" : activeTab;

  return (
    <div id="detail">
      <div id="toolbar">
        <span id="toolbar-path">{`${session.path} · ${records.length} turns`}</span>
        {session.model ? (
          <span id="toolbar-model">{session.model.split("/").pop()}</span>
        ) : null}
        {last?.latency != null ? (
          <span id="toolbar-latency" className="latency-badge">
            {last.latency} ms
          </span>
        ) : null}
        {usageText ? (
          <span id="toolbar-usage" className="usage-badge">
            {usageText}
          </span>
        ) : null}
        {hasSse ? (
          <span id="toolbar-stream" className="stream-badge">
            SSE Stream
          </span>
        ) : null}
      </div>

      <div id="tabbar">
        <TabButton label="消息" value="pretty" activeTab={visibleTab} onSelect={setActiveTab} />
        <TabButton label="Session JSON" value="raw-json" activeTab={visibleTab} onSelect={setActiveTab} />
        {hasSse ? (
          <TabButton label="SSE Chunks" value="chunks" activeTab={visibleTab} onSelect={setActiveTab} />
        ) : null}
      </div>

      <div id="content">
        {visibleTab === "pretty" ? (
          <div id="panel-pretty" className="panel active">
            <div id="session-turns" className="turn-list">
              {visibleRecords.map((record) => (
                <TurnCard
                  key={record.id}
                  record={record}
                  turnIndex={records.findIndex((item) => item.id === record.id) + 1}
                  isSelected
                />
              ))}
            </div>
          </div>
        ) : null}

        {visibleTab === "raw-json" ? (
          <div id="panel-raw-json" className="panel active">
            <div className="section-head">
              当前会话 JSON
              <CopyButton text={JSON.stringify(payload, null, 2)} />
            </div>
            <div className="session-json-wrap">
              <pre id="session-raw">{JSON.stringify(payload, null, 2) || "(empty)"}</pre>
            </div>
          </div>
        ) : null}

        {visibleTab === "chunks" ? (
          <div id="panel-chunks" className="panel active">
            <div className="section-head">
              当前会话的 SSE 数据
              <CopyButton
                text={records
                  .filter((record) => record.is_sse)
                  .flatMap((record) => record.sse_lines || [])
                  .join("\n")}
              />
            </div>
            <div id="chunks-view">{renderChunks(records.filter((record) => record.is_sse))}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TabButton({
  label,
  value,
  activeTab,
  onSelect,
}: {
  label: string;
  value: TabKey;
  activeTab: TabKey;
  onSelect: (tab: TabKey) => void;
}) {
  return (
    <button
      type="button"
      className={`tb ${activeTab === value ? "active" : ""}`}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}

function TurnCard({
  record,
  turnIndex,
  isSelected,
}: {
  record: RecordItem;
  turnIndex: number;
  isSelected: boolean;
}) {
  const reqJson = record.req_json || {};
  const messages = Array.isArray((reqJson as { messages?: Message[] }).messages)
    ? ((reqJson as { messages: Message[] }).messages)
    : [];
  const shouldStackPanes = messages.length > 1;
  const usageText = formatUsage(getRecordUsage(record));
  const metaParts = [
    record.time,
    record.method,
    record.status == null ? "pending" : String(record.status),
    record.latency != null ? `${record.latency}ms` : null,
    usageText || null,
  ].filter(Boolean);

  return (
    <div id={`turn-${record.id}`} className={`turn-card ${isSelected ? "selected" : ""}`}>
      <div className="turn-head">
        <span className="turn-index">#{turnIndex}</span>
        <span>{record.path}</span>
        <span className="turn-meta">{metaParts.join(" · ")}</span>
      </div>
      <div className={`turn-split ${shouldStackPanes ? "stacked" : ""}`}>
        <div className="turn-pane">
          <div className="turn-pane-head">Request</div>
          <div className="turn-pane-body">
            <div className="msg-list">
              {messages.length ? (
                messages.map((message, index) => (
                  <MessageCard
                    key={`${record.id}-req-${index}`}
                    role={message.role || "user"}
                    content={message.content}
                    toolCalls={message.tool_calls || []}
                    reasoning={null}
                  />
                ))
              ) : (
                <pre>{JSON.stringify(reqJson, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>
        <div className="turn-pane">
          <div className="turn-pane-head">Response</div>
          <div className="turn-pane-body">
            <div className="msg-list">
              <ResponseContent record={record} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResponseContent({ record }: { record: RecordItem }) {
  if (record.is_sse && record.resp_merged) {
    const choices = normalizeResponseChoices(record.resp_merged);
    return choices.length ? (
      <>
        {choices.map((choice, index) => (
          <MessageCard
            key={`${record.id}-merged-${index}`}
            role={choice.role}
            content={choice.content}
            reasoning={choice.reasoning}
            toolCalls={choice.toolCalls}
          />
        ))}
      </>
    ) : (
      <span className="muted-message">流式响应解析中…</span>
    );
  }

  if (record.resp_json) {
    const choices = normalizeResponseChoices(record.resp_json);
    if (choices.length) {
      return (
        <>
          {choices.map((choice, index) => (
            <MessageCard
              key={`${record.id}-json-${index}`}
              role={choice.role}
              content={choice.content}
              reasoning={choice.reasoning}
              toolCalls={choice.toolCalls}
            />
          ))}
        </>
      );
    }
    return <pre>{JSON.stringify(record.resp_json, null, 2)}</pre>;
  }

  if (record.resp_raw) {
    return <pre>{record.resp_raw}</pre>;
  }

  return <span className="muted-message">等待响应…</span>;
}

function MessageCard({
  role,
  content,
  reasoning,
  toolCalls,
}: {
  role: string;
  content: unknown;
  reasoning: string | null;
  toolCalls: ToolCall[];
}) {
  const dotClass = ["user", "assistant", "system", "tool"].includes(role)
    ? role
    : "user";

  return (
    <div className="msg-card">
      <div className="msg-card-head">
        <span className={`role-dot ${dotClass}`} />
        {role}
      </div>
      {renderMessageBody(role, content)}
      {reasoning ? <CollapsibleBlock title="思考链" tone="reasoning" content={reasoning} /> : null}
      {toolCalls.length ? (
        <CollapsibleToolCalls title={`Tool Calls (${toolCalls.length})`} toolCalls={toolCalls} />
      ) : null}
    </div>
  );
}

function renderMessageBody(role: string, content: unknown) {
  if (role === "tool") {
    const parts = Array.isArray(content) ? content : null;
    const text = parts
      ? parts.map((part) => JSON.stringify(part, null, 2)).join("\n")
      : String(content || "");
    return <div className="msg-card-body">{text}</div>;
  }

  if (Array.isArray(content)) {
    return (
      <>
        {content.map((block, index) => {
          if (
            block &&
            typeof block === "object" &&
            "type" in block &&
            (block as { type?: string }).type === "text"
          ) {
            return (
              <div key={index} className="msg-card-body">
                {String((block as { text?: string }).text || "")}
              </div>
            );
          }
          return (
            <div key={index} className="msg-card-body msg-card-body-muted">
              [{String((block as { type?: string }).type || "block")}]
            </div>
          );
        })}
      </>
    );
  }

  return <div className="msg-card-body">{String(content || "")}</div>;
}

function CollapsibleBlock({
  title,
  tone,
  content,
}: {
  title: string;
  tone: "reasoning";
  content: string;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className={`${tone}-block`}>
      <button
        type="button"
        className={`${tone}-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        {title}
      </button>
      <div className={`${tone}-body ${open ? "open" : ""}`}>{content}</div>
    </div>
  );
}

function CollapsibleToolCalls({
  title,
  toolCalls,
}: {
  title: string;
  toolCalls: ToolCall[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="tool-calls-block">
      <button
        type="button"
        className={`tool-calls-toggle ${open ? "open" : ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        {title}
      </button>
      <div className={`tool-calls-body ${open ? "open" : ""}`}>
        {toolCalls.map((toolCall, index) => {
          const fn = toolCall.function || {};
          const name = fn.name || toolCall.name || toolCall.id || "(unknown)";
          let args = fn.arguments ?? toolCall.arguments ?? "";
          try {
            args = JSON.stringify(JSON.parse(args), null, 2);
          } catch {
            // Keep original string when not valid JSON.
          }

          return (
            <div key={`${name}-${index}`} className="tool-call-item">
              <div className="tool-call-name">{name}</div>
              <div className="tool-call-args">{args}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderChunks(records: RecordItem[]) {
  if (!records.length) {
    return <div className="empty-panel">当前会话没有 SSE 数据</div>;
  }

  return records.map((record, recordIndex) => (
    <div key={record.id}>
      <div className="chunk-group-title">
        #{recordIndex + 1} · {record.time} · {record.path}
      </div>
      {(record.sse_lines || []).map((line, lineIndex) => {
        const trimmed = line.trim();
        const className =
          trimmed === "data: [DONE]"
            ? "chunk-line done"
            : trimmed.startsWith("data:")
              ? "chunk-line data"
              : trimmed
                ? "chunk-line"
                : "chunk-line empty";

        return (
          <div key={`${record.id}-${lineIndex}`} className={className}>
            {line}
          </div>
        );
      })}
    </div>
  ));
}

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "error">("idle");

  async function handleClick() {
    try {
      await copyText(text);
      setState("done");
    } catch {
      setState("error");
    } finally {
      window.setTimeout(() => setState("idle"), 1500);
    }
  }

  return (
    <button className="copy-btn" type="button" onClick={handleClick}>
      {state === "done" ? "已复制" : state === "error" ? "失败" : "复制"}
    </button>
  );
}
