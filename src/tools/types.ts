import type { ZodRawShape } from "zod";
import type { AdbClient } from "../adb/client.js";
import type { Confirmer } from "../elicit.js";
import type { Capability, SecurityPolicy } from "../security.js";

export interface ToolContext {
  client: AdbClient;
  policy: SecurityPolicy;
  /** Human-in-the-loop confirmation for destructive ops (no-op fallback when the client can't elicit). */
  confirm: Confirmer;
}

export interface ToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  capability: Capability;
  /** Marks a mutating tool as destructive (data loss possible). Defaults to `capability === "admin"`. */
  destructive?: boolean;
  /** Overrides the idempotency hint. Defaults to `true` for read tools, `false` otherwise. */
  idempotent?: boolean;
  enabledWhen?: (p: SecurityPolicy) => boolean;
  config: { title: string; description: string; inputSchema: Shape };
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

export function jsonResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
export function imageResult(base64Png: string, caption?: string): ToolResult {
  const content: ToolResult["content"] = [{ type: "image", data: base64Png, mimeType: "image/png" }];
  if (caption) content.unshift({ type: "text", text: caption });
  return { content };
}
