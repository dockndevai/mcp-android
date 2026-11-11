import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AdbClient } from "../src/adb/client.js";
import { shellQuote } from "../src/adb/shell.js";
import { loadConfig } from "../src/config.js";
import type { AppConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

/**
 * `adb shell <args>` joins its arguments into ONE string that the device's shell parses. These tests
 * stand in for both ends: a fake `adb` records exactly what is handed over, and that string is then
 * run through a real `sh -c` whose `input` / `am` are recorders (and whose cwd holds a canary), so we
 * assert not just the quoting but that nothing a payload says is ever executed.
 */
const root = mkdtempSync(join(tmpdir(), "mcp-android-inj-"));
const bin = join(root, "bin");
const record = join(root, "adb-calls.jsonl"); // what the fake adb received (argv)
const devlog = join(root, "device-calls.jsonl"); // what the "device" commands received (argv)
const canary = join(root, "PWNED");

const NODE = process.execPath;
const recorderScript = (file: string) =>
  `#!${NODE}\nrequire("node:fs").appendFileSync(${JSON.stringify(file)}, JSON.stringify([require("node:path").basename(process.argv[1]), ...process.argv.slice(2)]) + "\\n");\n`;

beforeAll(() => {
  mkdirSync(bin);
  writeFileSync(join(bin, "adb"), recorderScript(record));
  chmodSync(join(bin, "adb"), 0o755);
  for (const cmd of ["input", "am"]) {
    writeFileSync(join(bin, cmd), recorderScript(devlog));
    chmodSync(join(bin, cmd), 0o755);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  for (const f of [record, devlog, canary]) rmSync(f, { force: true });
});

const lines = (file: string): string[][] =>
  existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

const adb = () => new AdbClient({ adbPath: join(bin, "adb"), timeout: 5000 });

/** The single string(s) handed to the device shell by `adb shell <string>`. */
function shellStrings(): string[] {
  return lines(record).map((argv) => {
    expect(argv[0]).toBe("adb");
    expect(argv[1]).toBe("shell");
    expect(argv).toHaveLength(3); // exactly ONE string for the device shell, nothing for adb to re-join
    return argv[2];
  });
}

/** Run what adb would hand the device, in a real sh, and return what `input`/`am` received. */
function runOnDevice(strings: string[]): string[][] {
  for (const s of strings) {
    execFileSync("sh", ["-c", s], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, cwd: root });
  }
  return lines(devlog);
}

const PAYLOADS = [
  `a; touch ${canary}`,
  `a && touch ${canary}`,
  `a | touch ${canary}`,
  `$(touch ${canary})`,
  "`touch " + canary + "`",
  `a'; touch ${canary}; echo '`,
  `a"; touch ${canary}; echo "`,
  `a\ntouch ${canary}\n`,
  `a > ${canary}`,
  `a & touch ${canary} &`,
  `\\'; touch ${canary} #`,
  `\${IFS}touch${"${IFS}"}${canary}`,
  `$HOME ~ * ? [a-z] {a,b} !`,
];

describe("input_text reaches the device shell as one safely quoted argument", () => {
  it("quotes shell metacharacters (exact string)", async () => {
    await adb().inputText("a; rm -rf /sdcard/x");
    expect(shellStrings()).toEqual(["input text 'a;%srm%s-rf%s/sdcard/x'"]);
  });

  it("quotes $(…), backticks, quotes and newlines (exact string)", async () => {
    const c = adb();
    await c.inputText("$(id)");
    await c.inputText("`id`");
    await c.inputText("it's");
    await c.inputText('say "hi"');
    await c.inputText("a\nb");
    expect(shellStrings()).toEqual([
      "input text '$(id)'",
      "input text '`id`'",
      "input text 'it'\\''s'",
      `input text 'say%s"hi"'`,
      "input text 'a\nb'",
    ]);
  });

  it.each(PAYLOADS.map((p) => [JSON.stringify(p), p]))("never executes payload %s", async (_n, payload) => {
    await adb().inputText(payload);
    const got = runOnDevice(shellStrings());
    expect(existsSync(canary)).toBe(false);
    expect(got).toEqual([["input", "text", payload.replace(/ /g, "%s")]]);
  });

  it("encodes spaces as %s and leaves plain words unquoted", async () => {
    await adb().inputText("hello world");
    expect(shellStrings()).toEqual(["input text hello%sworld"]);
  });

  it("types a literal '%s' by splitting it, because input text turns %s into a space", async () => {
    await adb().inputText("100%s sure");
    const got = runOnDevice(shellStrings());
    // '100%' then 's%ssure': neither command contains a "%s" the device would turn into a space
    expect(got).toEqual([["input", "text", "100%"], ["input", "text", "s%ssure"]]);
  });

  it("splits every literal %s and keeps other percent signs intact", async () => {
    await adb().inputText("%%s");
    expect(runOnDevice(shellStrings()).map((g) => g[2])).toEqual(["%%", "s"]);
  });

  it("types nothing for empty text", async () => {
    await adb().inputText("");
    expect(shellStrings()).toEqual([]);
  });

  it("rejects a NUL byte", async () => {
    await expect(adb().inputText("a\0b")).rejects.toThrow(/NUL/);
    expect(shellStrings()).toEqual([]);
  });
});

describe("open_url", () => {
  it("quotes the URL and runs no payload (exact string)", async () => {
    await adb().openUrl("https://example.com/?q=a;b&c=$(id)");
    expect(shellStrings()).toEqual([
      "am start -a android.intent.action.VIEW -d 'https://example.com/?q=a;b&c=$(id)'",
    ]);
  });

  it.each([
    `https://e.com/;touch ${canary}`,
    `https://e.com/$(touch ${canary})`,
    "https://e.com/`touch " + canary + "`",
    `https://e.com/'; touch ${canary}; echo '`,
    `https://e.com/ x; touch ${canary}`,
  ])("never executes %s", async (url) => {
    await adb().openUrl(url);
    const got = runOnDevice(shellStrings());
    expect(existsSync(canary)).toBe(false);
    expect(got).toEqual([["am", "start", "-a", "android.intent.action.VIEW", "-d", url]]);
  });

  it.each(["http://a.com/x", "HTTPS://a.com", "tel:+15551234", "mailto:a@b.co", "geo:37.78,-122.41", "market://details?id=com.x"])(
    "allows %s",
    async (url) => {
      await adb().openUrl(url);
      expect(shellStrings()).toHaveLength(1);
    },
  );

  it.each([
    "javascript:alert(1)",
    "file:///sdcard/x",
    "content://sms/inbox",
    "intent:#Intent;action=android.intent.action.CALL;end",
    "android-app://com.x",
    "sms:123",
    "-n com.evil/.A",
    "--es x y",
    "no-scheme",
    "//host/path",
    " https://a.com",
    "https://a.com\n--es x y",
    "https://a.com\0",
    "",
  ])("refuses %s without touching adb", async (url) => {
    await expect(adb().openUrl(url)).rejects.toThrow(/URL/);
    expect(lines(record)).toEqual([]);
  });

  it("allows configured extra schemes, and only those", async () => {
    const c = new AdbClient({ adbPath: join(bin, "adb"), timeout: 5000, extraUrlSchemes: ["spotify", "Zoommtg"] });
    await c.openUrl("spotify:track:1");
    await c.openUrl("zoommtg://x");
    await expect(c.openUrl("sms:1")).rejects.toThrow(/URL/);
    expect(shellStrings()).toHaveLength(2);
  });
});

describe("alarm and timer messages", () => {
  it("quotes the message (exact string) and runs no payload", async () => {
    const c = adb();
    await c.setAlarm(7, 30, `wake; touch ${canary}`);
    await c.setTimer(60, `$(touch ${canary})`);
    const strings = shellStrings();
    expect(strings[0]).toContain(`-e android.intent.extra.alarm.MESSAGE 'wake; touch ${canary}'`);
    const got = runOnDevice(strings);
    expect(existsSync(canary)).toBe(false);
    expect(got[0].slice(-2)).toEqual(["android.intent.extra.alarm.MESSAGE", `wake; touch ${canary}`]);
    expect(got[1].slice(-2)).toEqual(["android.intent.extra.alarm.MESSAGE", `$(touch ${canary})`]);
  });

  it("refuses non-integer numbers instead of putting them in a command", async () => {
    const c = adb();
    await expect(c.setAlarm(7.5, 0, "x")).rejects.toThrow(/integer/);
    await expect(c.setTimer(Number.NaN, "x")).rejects.toThrow(/integer/);
    await expect(c.tap(1, "1; id" as unknown as number)).rejects.toThrow(/integer/);
    await expect(c.swipe(1, 2, 3, 4, "5; id" as unknown as number)).rejects.toThrow(/integer/);
    expect(lines(record)).toEqual([]);
  });
});

describe("other client methods that build a device shell string", () => {
  it("press_key only accepts KEYCODE_* names or digits", async () => {
    const c = adb();
    await c.key("KEYCODE_HOME");
    await expect(c.key("HOME; id")).rejects.toThrow(/keycode/i);
    await expect(c.key("KEYCODE_HOME;id")).rejects.toThrow(/keycode/i);
    expect(shellStrings()).toEqual(["input keyevent KEYCODE_HOME"]);
  });

  it("package names still cannot carry shell syntax", async () => {
    await expect(adb().launchApp("com.x; id")).rejects.toThrow(/Invalid package/);
    await expect(adb().clearAppData("$(id)")).rejects.toThrow(/Invalid package/);
    await expect(adb().packageVersion("a b")).rejects.toThrow(/Invalid package/);
  });

  it("install resolves the path so a leading '-' cannot become an adb option", async () => {
    await adb().install("-g");
    const [argv] = lines(record);
    expect(argv.slice(1, 3)).toEqual(["install", "-r"]);
    expect(argv[3].startsWith("/")).toBe(true);
    expect(argv[3].endsWith("/-g")).toBe(true);
  });
});

describe("through the MCP tools (read-write mode: run_shell is NOT enabled)", () => {
  const cfg = (extra: Partial<AppConfig["security"]> = {}): AppConfig => ({
    connection: { adbPath: join(bin, "adb"), timeout: 5000 },
    security: {
      mode: "read-write",
      packageAllowlist: [],
      protectedPackages: [],
      allowInstall: false,
      allowShell: false,
      dryRun: false,
      auditLog: false,
      requireHumanApproval: false,
      ...extra,
    },
  });
  async function connect(c: AppConfig) {
    const { server } = buildServer(c);
    const client = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  const text = (r: unknown) => (r as { content: Array<{ text: string }> }).content[0]?.text ?? "";

  it("input_text cannot run a command (bypassing the ANDROID_ALLOW_SHELL gate)", async () => {
    const client = await connect(cfg());
    const res = await client.callTool({ name: "input_text", arguments: { text: `x; touch ${canary}` } });
    expect(res.isError).toBeFalsy();
    runOnDevice(shellStrings());
    expect(existsSync(canary)).toBe(false);
  });

  it("open_url refuses a non-allowlisted scheme with an error result", async () => {
    const client = await connect(cfg());
    const res = await client.callTool({ name: "open_url", arguments: { url: "javascript:alert(1)" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/URL scheme/);
    expect(lines(record)).toEqual([]);
  });

  it("open_url validates BEFORE dry-run, so a dry run reports the refusal too", async () => {
    const client = await connect(cfg({ dryRun: true }));
    const bad = await client.callTool({ name: "open_url", arguments: { url: "file:///etc/passwd" } });
    expect(bad.isError).toBe(true);
    const ok = await client.callTool({ name: "open_url", arguments: { url: "https://a.com" } });
    expect(text(ok)).toContain("[dry-run]");
    expect(lines(record)).toEqual([]);
  });
});

describe("shellQuote", () => {
  it("leaves only characters with no shell meaning bare, and quotes everything else", () => {
    expect(shellQuote("com.android.deskclock")).toBe("com.android.deskclock");
    expect(shellQuote("/sdcard/mcp_ui.xml")).toBe("/sdcard/mcp_ui.xml");
    expect(shellQuote("")).toBe("''");
    for (const c of ["~", "*", "?", "[", "]", "{", "}", "#", "!", "$", "`", "\\", '"', "'", ";", "&", "|", "<", ">", "(", ")", " ", "\t", "\n", "^"]) {
      expect(shellQuote(`a${c}b`), JSON.stringify(c)).toMatch(/^'.*'$/s);
    }
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe("ANDROID_EXTRA_URL_SCHEMES", () => {
  it("is parsed, lower-cased and validated at startup", () => {
    const prev = process.env.ANDROID_EXTRA_URL_SCHEMES;
    try {
      process.env.ANDROID_EXTRA_URL_SCHEMES = "Spotify, zoommtg";
      expect(loadConfig().connection.extraUrlSchemes).toEqual(["spotify", "zoommtg"]);
      process.env.ANDROID_EXTRA_URL_SCHEMES = "ok,bad scheme;x";
      expect(() => loadConfig()).toThrow(/Invalid URL scheme/);
      delete process.env.ANDROID_EXTRA_URL_SCHEMES;
      expect(loadConfig().connection.extraUrlSchemes).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.ANDROID_EXTRA_URL_SCHEMES;
      else process.env.ANDROID_EXTRA_URL_SCHEMES = prev;
    }
  });
});
