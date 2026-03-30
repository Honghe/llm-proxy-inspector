import type { SessionSummary } from "../../shared/types/api";
import { ClearHistoryButton } from "../../features/clear-history/ClearHistoryButton";

interface SidebarProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  onSelectSession: (sessionId: string) => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
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
              <button
                key={session.id}
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
            );
          })
        ) : (
          <div className="list-empty">等待请求…</div>
        )}
      </div>
    </aside>
  );
}
