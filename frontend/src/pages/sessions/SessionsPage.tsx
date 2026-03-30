import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";

import { fetchSession, fetchSessions } from "../../entities/session/api";
import { SessionDetail } from "../../widgets/session-detail/SessionDetail";
import { Sidebar } from "../../widgets/sidebar/Sidebar";

export function SessionsPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams();

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
    refetchInterval: 5000,
  });

  const sessionQuery = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => fetchSession(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.session.done ? false : 5000;
    },
  });

  const sessions = sessionsQuery.data || [];

  return (
    <div className="app-shell">
      <Sidebar
        sessions={sessions}
        activeSessionId={sessionId}
        onSelectSession={(nextSessionId) => navigate(`/sessions/${nextSessionId}`, { replace: true })}
      />

      <main id="main">
        {!sessionId ? (
          <EmptyState message={sessionsQuery.isLoading ? "加载会话中…" : "从左侧选择一个会话"} />
        ) : sessionQuery.isLoading ? (
          <EmptyState message="加载会话中…" />
        ) : sessionQuery.isError ? (
          <EmptyState message="会话加载失败" />
        ) : sessionQuery.data ? (
          <SessionDetail payload={sessionQuery.data} />
        ) : (
          <EmptyState message="未找到该会话" />
        )}
      </main>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div id="empty">
      <div className="big">🔍</div>
      <p>{message}</p>
    </div>
  );
}
