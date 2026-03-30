import type { RecordItem, ToolCall, Usage } from "../../shared/types/api";

export interface NormalizedChoice {
  role: string;
  content: unknown;
  reasoning: string | null;
  toolCalls: ToolCall[];
}

export function getRecordUsage(record?: RecordItem | null): Usage | null {
  const payload = (record?.resp_merged || record?.resp_json) as
    | { usage?: Usage }
    | null
    | undefined;
  return payload?.usage && typeof payload.usage === "object" ? payload.usage : null;
}

export function normalizeResponseChoices(payload: unknown): NormalizedChoice[] {
  if (!payload || typeof payload !== "object") return [];

  const source = payload as {
    choices?: Array<Record<string, unknown>>;
    output?: Array<Record<string, unknown>>;
  };

  if (Array.isArray(source.choices)) {
    return source.choices.map((choice) => {
      const message =
        choice.message && typeof choice.message === "object"
          ? (choice.message as Record<string, unknown>)
          : null;

      return {
        role: String(message?.role ?? choice.role ?? "assistant"),
        content: message?.content ?? choice.content ?? "",
        reasoning: String(message?.reasoning_content ?? choice.reasoning_content ?? "") || null,
        toolCalls: ((message?.tool_calls ?? choice.tool_calls ?? []) as ToolCall[]) || [],
      };
    });
  }

  const output = Array.isArray(source.output) ? source.output : [];
  if (!output.length) return [];

  let role = "assistant";
  let content = "";
  let reasoning = "";
  const toolCalls: ToolCall[] = [];

  output.forEach((item) => {
    if (!item || typeof item !== "object") return;
    if (item.type === "message") {
      role = String(item.role || role);
      const parts = Array.isArray(item.content) ? item.content : [];
      content += parts
        .filter((part) => part && typeof part === "object" && (part as { type?: string }).type === "output_text")
        .map((part) => String((part as { text?: string }).text || ""))
        .join("");
    } else if (item.type === "reasoning") {
      const parts = Array.isArray(item.summary) ? item.summary : [];
      const text = parts
        .filter((part) => part && typeof part === "object" && typeof (part as { text?: string }).text === "string")
        .map((part) => String((part as { text?: string }).text || ""))
        .filter(Boolean)
        .join("\n");
      if (text) reasoning += (reasoning ? "\n" : "") + text;
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: String(item.call_id || item.id || ""),
        type: "function",
        function: {
          name: String(item.name || item.id || "(unknown)"),
          arguments: String(item.arguments || ""),
        },
      });
    }
  });

  return [
    {
      role,
      content,
      reasoning: reasoning || null,
      toolCalls,
    },
  ];
}
