import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AdbClient, AdbError } from "./adb/client.js";
import type { AppConfig } from "./config.js";
import { makeConfirmer } from "./elicit.js";
import { PolicyError, SecurityPolicy } from "./security.js";
import { adminTools } from "./tools/admin.js";
import { readTools } from "./tools/read.js";
import type { ToolContext, ToolDef } from "./tools/types.js";
import { writeTools } from "./tools/write.js";

const ALL_TOOLS: ToolDef[] = [...readTools, ...writeTools, ...adminTools];

export function buildServer(config: AppConfig): { server: McpServer; enabled: string[] } {
  const policy = new SecurityPolicy(config.security);
  const client = new AdbClient(config.connection);

  const server = new McpServer({ name: "mcp-android", version: "0.1.0" });
  const ctx: ToolContext = { client, policy, confirm: makeConfirmer(server) };

  const enabled: string[] = [];
  for (const tool of ALL_TOOLS) {
    if (!policy.isCapabilityEnabled(tool.capability)) continue;
    if (tool.enabledWhen && !tool.enabledWhen(policy)) continue;
    enabled.push(tool.name);
    server.registerTool(tool.name, tool.config, async (args: Record<string, unknown>) => {
      try {
        return await tool.handler(args ?? {}, ctx);
      } catch (err) {
        return toErrorResult(err);
      }
    });
  }
  return { server, enabled };
}

function toErrorResult(err: unknown) {
  let message: string;
  if (err instanceof PolicyError) message = `Policy denied: ${err.message}`;
  else if (err instanceof AdbError) message = err.message;
  else if (err instanceof Error) message = `${err.name}: ${err.message}`;
  else message = String(err);
  return { content: [{ type: "text" as const, text: message }], isError: true };
}
