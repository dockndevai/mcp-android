import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AppConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

/**
 * The tool input schemas are the public contract a client sees in tools/list. This pins them
 * (property names, types, required, enums, numeric bounds) so a dependency bump (e.g. zod) cannot
 * silently change what is advertised. Regenerate deliberately with UPDATE_SCHEMAS=1.
 */
const SNAPSHOT = new URL("./schemas.snapshot.json", import.meta.url);

const config = (): AppConfig => ({
  connection: { adbPath: "adb-not-used", timeout: 1000 },
  security: {
    mode: "admin",
    packageAllowlist: [],
    protectedPackages: [],
    allowInstall: true,
    allowShell: true,
    dryRun: false,
    auditLog: false,
    requireHumanApproval: false,
  },
});

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Keep the parts of a JSON Schema that define the contract; drop generator noise. Two things differ
 * between the zod 3 and zod 4 JSON Schema converters without changing what a tool accepts: zod 3 emitted
 * \`additionalProperties: false\` on every object (the server strips unknown keys either way), and
 * zod 4 adds the safe-integer bounds to \`.int()\` fields. Everything else is compared as is.
 */
function contract(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(contract);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) {
      if (k === "$schema") continue;
      if (k === "additionalProperties" && v === false) continue;
      if ((k === "maximum" && v === MAX_SAFE) || (k === "minimum" && v === -MAX_SAFE)) continue;
      out[k] = contract(v);
    }
    return out;
  }
  return schema;
}

describe("tool input schemas", () => {
  it("advertise the pinned shapes over tools/list", async () => {
    const { server } = buildServer(config());
    const client = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    const actual = Object.fromEntries(tools.map((t) => [t.name, contract(t.inputSchema)]).sort(([x], [y]) => String(x).localeCompare(String(y))));
    if (process.env.UPDATE_SCHEMAS) writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + "\n");
    expect(Object.keys(actual).length).toBeGreaterThan(10);
    expect(actual).toEqual(JSON.parse(readFileSync(SNAPSHOT, "utf8")));
  });
});
