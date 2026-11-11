import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AdbClient } from "../src/adb/client.js";
import type { AppConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

const config = (requireHumanApproval = false): AppConfig => ({
  connection: { adbPath: "adb-not-used", timeout: 1000 },
  security: {
    mode: "admin",
    packageAllowlist: [],
    protectedPackages: ["com.android.settings"],
    allowInstall: true,
    allowShell: true,
    dryRun: false,
    auditLog: false,
    requireHumanApproval,
  },
});

type Answer = { action: "accept" | "decline"; content?: Record<string, unknown> };

/** Connect an in-memory MCP client (optionally able to answer elicitation) to a freshly built server. */
async function connect(opts: { requireHuman?: boolean; answer?: (message: string) => Answer | Promise<Answer>; elicits?: boolean }) {
  const { server } = buildServer(config(opts.requireHuman));
  const prompts: string[] = [];
  const client = new Client({ name: "t", version: "0" }, { capabilities: opts.elicits === false ? {} : { elicitation: {} } });
  if (opts.elicits !== false) {
    client.setRequestHandler(ElicitRequestSchema, async (req) => {
      prompts.push(req.params.message);
      return (await opts.answer?.(req.params.message)) ?? { action: "accept", content: { confirm: true } };
    });
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, prompts };
}

const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0]?.text ?? "");

afterEach(() => vi.restoreAllMocks());

describe("uninstall_app approval (end to end)", () => {
  it("shows the tool, full arguments, version and fingerprint, then uninstalls", async () => {
    vi.spyOn(AdbClient.prototype, "packageVersion").mockResolvedValue("1.2.3 (45) #ab12cd34");
    const uninstall = vi.spyOn(AdbClient.prototype, "uninstall").mockResolvedValue("Success");
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "uninstall_app", arguments: { package: "com.example.app" } });
    expect(text(res)).toBe("Success");
    expect(uninstall).toHaveBeenCalledWith("com.example.app");
    expect(prompts[0]).toContain("tool: uninstall_app");
    expect(prompts[0]).toContain('{"package":"com.example.app"}');
    expect(prompts[0]).toContain("resource version: 1.2.3 (45) #ab12cd34");
    expect(prompts[0]).toMatch(/fingerprint: [0-9a-f]{16}/);
  });

  it("does NOT uninstall when the app was updated while the human was deciding", async () => {
    const versions = ["1.2.3 (45) #aaaa", "1.3.0 (46) #bbbb"];
    vi.spyOn(AdbClient.prototype, "packageVersion").mockImplementation(async () => versions.shift());
    const uninstall = vi.spyOn(AdbClient.prototype, "uninstall").mockResolvedValue("Success");
    const { client } = await connect({});
    const res = await client.callTool({ name: "uninstall_app", arguments: { package: "com.example.app" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(uninstall).not.toHaveBeenCalled();
  });

  it("does NOT uninstall when the human declines", async () => {
    vi.spyOn(AdbClient.prototype, "packageVersion").mockResolvedValue("v1");
    const uninstall = vi.spyOn(AdbClient.prototype, "uninstall").mockResolvedValue("Success");
    const { client } = await connect({ answer: () => ({ action: "decline" }) });
    await client.callTool({ name: "uninstall_app", arguments: { package: "com.example.app" } });
    expect(uninstall).not.toHaveBeenCalled();
  });
});

describe("clear_app_data approval (end to end)", () => {
  it("proceeds when the version is stable", async () => {
    vi.spyOn(AdbClient.prototype, "packageVersion").mockResolvedValue("v1");
    const clear = vi.spyOn(AdbClient.prototype, "clearAppData").mockResolvedValue("Success");
    const { client, prompts } = await connect({});
    await client.callTool({ name: "clear_app_data", arguments: { package: "com.example.app" } });
    expect(clear).toHaveBeenCalledWith("com.example.app");
    expect(prompts[0]).toContain("tool: clear_app_data");
  });

  it("does NOT clear data when the package version changed", async () => {
    const versions = ["v1", "v2"];
    vi.spyOn(AdbClient.prototype, "packageVersion").mockImplementation(async () => versions.shift());
    const clear = vi.spyOn(AdbClient.prototype, "clearAppData").mockResolvedValue("Success");
    const { client } = await connect({});
    const res = await client.callTool({ name: "clear_app_data", arguments: { package: "com.example.app" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("run_shell and install_apk bind their state too", () => {
  it("run_shell shows the exact command and refuses if a different device is attached", async () => {
    const ids = ["SER1|build-a", "SER2|build-b"];
    vi.spyOn(AdbClient.prototype, "deviceIdentity").mockImplementation(async () => ids.shift() as string);
    const shell = vi.spyOn(AdbClient.prototype, "rawShell").mockResolvedValue("ok");
    const { client, prompts } = await connect({});
    const res = await client.callTool({ name: "run_shell", arguments: { command: "dumpsys battery" } });
    expect(prompts[0]).toContain('{"command":"dumpsys battery"}');
    expect(text(res)).toContain("resource changed since the prompt");
    expect(shell).not.toHaveBeenCalled();
  });

  it("install_apk refuses when the APK file changed while the human was deciding", async () => {
    const versions = ["100B mtime=1 ino=7 #a", "200B mtime=2 ino=7 #a"];
    vi.spyOn(AdbClient.prototype, "apkVersion").mockImplementation(async () => versions.shift());
    const install = vi.spyOn(AdbClient.prototype, "install").mockResolvedValue("Success");
    const { client } = await connect({});
    const res = await client.callTool({ name: "install_apk", arguments: { apkPath: "/tmp/app.apk" } });
    expect(text(res)).toContain("resource changed since the prompt");
    expect(install).not.toHaveBeenCalled();
  });
});

describe("ANDROID_REQUIRE_HUMAN_APPROVAL", () => {
  it("falls back to the flags when the client cannot elicit (default)", async () => {
    vi.spyOn(AdbClient.prototype, "packageVersion").mockResolvedValue("v1");
    const uninstall = vi.spyOn(AdbClient.prototype, "uninstall").mockResolvedValue("Success");
    const { client } = await connect({ elicits: false });
    await client.callTool({ name: "uninstall_app", arguments: { package: "com.example.app" } });
    expect(uninstall).toHaveBeenCalledWith("com.example.app");
  });

  it("refuses when the client cannot elicit and human approval is required", async () => {
    vi.spyOn(AdbClient.prototype, "packageVersion").mockResolvedValue("v1");
    const uninstall = vi.spyOn(AdbClient.prototype, "uninstall").mockResolvedValue("Success");
    const shell = vi.spyOn(AdbClient.prototype, "rawShell").mockResolvedValue("ok");
    vi.spyOn(AdbClient.prototype, "deviceIdentity").mockResolvedValue("S|b");
    const { client, prompts } = await connect({ elicits: false, requireHuman: true });
    const res = await client.callTool({ name: "uninstall_app", arguments: { package: "com.example.app" } });
    const res2 = await client.callTool({ name: "run_shell", arguments: { command: "id" } });
    expect(text(res)).toContain("no human approval channel");
    expect(text(res2)).toContain("no human approval channel");
    expect(uninstall).not.toHaveBeenCalled();
    expect(shell).not.toHaveBeenCalled();
    expect(prompts).toHaveLength(0);
  });
});

describe("package names never reach a device shell unvalidated", () => {
  it("rejects shell syntax in a package name before the version probe or the clear runs", async () => {
    const shellSpy = vi.spyOn(AdbClient.prototype as unknown as { run: () => Promise<string> }, "run").mockResolvedValue("");
    const { client } = await connect({});
    const res = await client.callTool({ name: "clear_app_data", arguments: { package: "com.example.app; rm -rf /sdcard/x" } });
    expect(text(res)).toContain("Invalid package name");
    expect(shellSpy).not.toHaveBeenCalled();
  });
});

describe("version tokens", () => {
  const DUMPSYS = `Packages:
  Package [com.example.app] (abc):
    versionCode=45 minSdk=26 targetSdk=34
    versionName=1.2.3
    firstInstallTime=2026-01-02 03:04:05
    lastUpdateTime=2026-02-03 04:05:06
    lastTimeUsed=2026-11-11 10:00:00
`;
  function fakeAdb(dump: string, serial = "SER1") {
    const adb = new AdbClient({ adbPath: "adb-not-used", timeout: 1000 });
    vi.spyOn(adb as unknown as { run: (a: string[]) => Promise<string> }, "run").mockImplementation(async (args: string[]) => {
      if (args[0] === "get-serialno") return `${serial}\n`;
      if (args.includes("dumpsys")) return dump;
      return "fingerprint-x\n";
    });
    return adb;
  }

  it("packageVersion is readable, stable across runs, and ignores volatile fields", async () => {
    const a = await fakeAdb(DUMPSYS).packageVersion("com.example.app");
    const b = await fakeAdb(DUMPSYS.replace("10:00:00", "11:59:59")).packageVersion("com.example.app");
    expect(a).toMatch(/^1\.2\.3 \(45\) #[0-9a-f]{8}$/);
    expect(b).toBe(a);
  });

  it("packageVersion changes on update, reinstall or a different device; undefined when not installed", async () => {
    const base = await fakeAdb(DUMPSYS).packageVersion("com.example.app");
    expect(await fakeAdb(DUMPSYS.replace("2026-02-03", "2026-03-03")).packageVersion("com.example.app")).not.toBe(base);
    expect(await fakeAdb(DUMPSYS.replace("2026-01-02", "2026-04-04")).packageVersion("com.example.app")).not.toBe(base);
    expect(await fakeAdb(DUMPSYS, "SER2").packageVersion("com.example.app")).not.toBe(base);
    expect(await fakeAdb("Unable to find package: com.example.app\n").packageVersion("com.example.app")).toBeUndefined();
  });

  it("apkVersion is undefined for a missing file and tracks size/mtime for an existing one", async () => {
    const { mkdtempSync, writeFileSync, utimesSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const adb = fakeAdb(DUMPSYS);
    const dir = mkdtempSync(join(tmpdir(), "apk-"));
    const f = join(dir, "a.apk");
    expect(await adb.apkVersion(f)).toBeUndefined();
    writeFileSync(f, "one");
    utimesSync(f, 1000, 1000);
    const v1 = await adb.apkVersion(f);
    expect(await adb.apkVersion(f)).toBe(v1);
    writeFileSync(f, "three");
    utimesSync(f, 2000, 2000);
    expect(await adb.apkVersion(f)).not.toBe(v1);
  });
});
