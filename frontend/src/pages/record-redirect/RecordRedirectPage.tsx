import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router-dom";

import { fetchRecord } from "../../entities/session/api";

export function RecordRedirectPage() {
  const { recordId } = useParams();
  const recordQuery = useQuery({
    queryKey: ["record", recordId],
    queryFn: () => fetchRecord(recordId!),
    enabled: Boolean(recordId),
  });

  if (recordQuery.isLoading) {
    return (
      <div id="empty">
        <div className="big">🔍</div>
        <p>加载记录中…</p>
      </div>
    );
  }

  if (recordQuery.data?.session_id) {
    return <Navigate to={`/sessions/${recordQuery.data.session_id}`} replace />;
  }

  return <Navigate to="/" replace />;
}
