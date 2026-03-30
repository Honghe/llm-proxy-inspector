export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_token_count?: number;
  output_token_count?: number;
  total_token_count?: number;
}

export interface SessionSummary {
  id: string;
  last_created_at: number;
  record_count: number;
  time: string;
  last_time: string;
  method: string;
  path: string;
  model?: string;
  status?: number | null;
  latency?: number | null;
  is_sse: boolean;
  done: boolean;
  last_record_id: string;
  preview?: string;
}

export interface ToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
  name?: string;
  arguments?: string;
}

export interface Message {
  role?: string;
  content?: unknown;
  tool_calls?: ToolCall[];
}

export interface RecordItem {
  id: string;
  session_id: string;
  created_at: number;
  time: string;
  method: string;
  path: string;
  model?: string;
  stream?: boolean;
  status?: number | null;
  latency?: number | null;
  is_sse: boolean;
  req_json?: Record<string, unknown>;
  resp_json?: Record<string, unknown> | null;
  resp_merged?: Record<string, unknown> | null;
  resp_raw?: string | null;
  sse_lines?: string[];
}

export interface SessionDetail {
  session: SessionSummary;
  records: RecordItem[];
}
