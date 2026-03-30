import type { Usage } from "../types/api";

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatUsage(usage?: Usage | null) {
  if (!usage) return "";

  const input =
    usage.input_tokens ?? usage.prompt_tokens ?? usage.prompt_token_count ?? null;
  const output =
    usage.output_tokens ??
    usage.completion_tokens ??
    usage.output_token_count ??
    null;
  const total =
    usage.total_tokens ??
    usage.total_token_count ??
    (typeof input === "number" && typeof output === "number" ? input + output : null);

  const parts: string[] = [];
  if (typeof input === "number") parts.push(`in ${formatNumber(input)}`);
  if (typeof output === "number") parts.push(`out ${formatNumber(output)}`);
  if (typeof total === "number") parts.push(`total ${formatNumber(total)}`);
  return parts.join(" · ");
}
