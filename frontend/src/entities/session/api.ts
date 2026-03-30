import { apiFetch } from "../../shared/lib/api";
import type { RecordItem, SessionDetail, SessionSummary } from "../../shared/types/api";

export function fetchSessions() {
  return apiFetch<SessionSummary[]>("/api/sessions");
}

export function fetchSession(sessionId: string) {
  return apiFetch<SessionDetail>(`/api/sessions/${sessionId}`);
}

export function fetchRecord(recordId: string) {
  return apiFetch<RecordItem>(`/api/records/${recordId}`);
}

export function clearRecords() {
  return apiFetch<{ cleared: boolean }>("/api/records", { method: "DELETE" });
}
