const DEFAULT_PROXY_PORT = "7654";
const API_STORAGE_KEY = "llmProxyInspectorApiBase";

function defaultApiBase() {
  const protocol =
    location.protocol === "http:" || location.protocol === "https:"
      ? location.protocol
      : "http:";
  const hostname = location.hostname || "127.0.0.1";
  return `${protocol}//${hostname}:${DEFAULT_PROXY_PORT}`;
}

export const API_BASE = (
  window.__API_BASE__ ||
  localStorage.getItem(API_STORAGE_KEY) ||
  defaultApiBase()
).replace(/\/+$/, "");

export function apiUrl(path: string) {
  return `${API_BASE}${path}`;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
