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
      </div>
      <div id="sidebar-list">
        {sessions.length ? (
          sessions.map((session) => {
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
          <div className="list-empty">等待请求…</div>
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
