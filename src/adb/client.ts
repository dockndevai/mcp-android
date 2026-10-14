/**
 * Thin wrapper over the `adb` CLI. Each method shells out with an argument
 * array (no shell string), so device text/URLs can't inject commands.
 */
import { execFile } from "node:child_process";
import type { AndroidConnection } from "../config.js";

export class AdbError extends Error {}

export class AdbClient {
  constructor(private readonly conn: AndroidConnection) {}

  private baseArgs(): string[] {
    return this.conn.serial ? ["-s", this.conn.serial] : [];
  }

  /** Run adb with the given args. `binary` returns stdout as a Buffer (for screencap). */
  private run(args: string[], binary = false): Promise<Buffer | string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.conn.adbPath,
        [...this.baseArgs(), ...args],
        { timeout: this.conn.timeout, maxBuffer: 64 * 1024 * 1024, encoding: binary ? "buffer" : "utf8" },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr && stderr.toString()) || err.message;
            return reject(new AdbError(`adb ${args[0]} failed: ${msg.trim()}`));
          }
          resolve(binary ? (stdout as Buffer) : (stdout as string));
        },
      );
    });
  }

  private shell(cmd: string[]): Promise<string> {
    return this.run(["shell", ...cmd]) as Promise<string>;
  }

  // --- Reads -----------------------------------------------------------------

  async listDevices(): Promise<Array<{ serial: string; state: string }>> {
    const out = (await this.run(["devices"])) as string;
    return out
      .split("\n")
      .slice(1)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [serial, state] = l.split(/\s+/);
        return { serial, state };
      });
  }

  async deviceInfo(): Promise<Record<string, string>> {
    const props = ["ro.product.model", "ro.product.manufacturer", "ro.build.version.release", "ro.build.version.sdk"];
    const out: Record<string, string> = {};
    for (const p of props) out[p] = (await this.shell(["getprop", p])).trim();
    const size = (await this.shell(["wm", "size"])).trim();
    out["screen"] = size.replace("Physical size: ", "");
    return out;
  }

  /** PNG screenshot as a base64 string. */
  async screenshot(): Promise<string> {
    const buf = (await this.run(["exec-out", "screencap", "-p"], true)) as Buffer;
    return buf.toString("base64");
  }

  /** UI hierarchy XML (uiautomator dump) for element targeting. */
  async uiDump(): Promise<string> {
    await this.shell(["uiautomator", "dump", "/sdcard/mcp_ui.xml"]).catch(() => undefined);
    return (await this.shell(["cat", "/sdcard/mcp_ui.xml"])).trim();
  }

  async currentApp(): Promise<string> {
    const out = await this.shell(["dumpsys", "window"]);
    const m = out.match(/mCurrentFocus=.*\s([\w.]+\/[\w.$]+)/) || out.match(/mResumedActivity.*\s([\w.]+\/[\w.$]+)/);
    return m ? m[1] : "(unknown)";
  }

  async listPackages(thirdPartyOnly = true): Promise<string[]> {
    const out = await this.shell(["pm", "list", "packages", ...(thirdPartyOnly ? ["-3"] : [])]);
    return out.split("\n").map((l) => l.replace("package:", "").trim()).filter(Boolean).sort();
  }

  async notifications(): Promise<string> {
    // Best-effort: recent notification records with their package + text.
    const out = await this.shell(["dumpsys", "notification", "--noredact"]).catch(() => "");
    const lines = out.split("\n").filter((l) => /pkg=|tickerText=|android\.title|android\.text/.test(l));
    return lines.slice(0, 200).join("\n") || "(no readable notifications; needs Android 11+)";
  }

  // --- Writes (UI control) ---------------------------------------------------

  tap(x: number, y: number) {
    return this.shell(["input", "tap", String(x), String(y)]);
  }
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs = 300) {
    return this.shell(["input", "swipe", String(x1), String(y1), String(x2), String(y2), String(durationMs)]);
  }
  inputText(text: string) {
    // adb `input text` uses %s for spaces and can't handle some chars; encode spaces.
    return this.shell(["input", "text", text.replace(/ /g, "%s")]);
  }
  key(keycode: string) {
    return this.shell(["input", "keyevent", keycode]);
  }
  launchApp(pkg: string) {
    return this.shell(["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  }
  openUrl(url: string) {
    return this.shell(["am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
  }
  setAlarm(hour: number, minutes: number, message: string) {
    return this.shell([
      "am", "start", "-a", "android.intent.action.SET_ALARM",
      "--ei", "android.intent.extra.alarm.HOUR", String(hour),
      "--ei", "android.intent.extra.alarm.MINUTES", String(minutes),
      "--ez", "android.intent.extra.alarm.SKIP_UI", "true",
      "-e", "android.intent.extra.alarm.MESSAGE", message,
    ]);
  }
  setTimer(seconds: number, message: string) {
    return this.shell([
      "am", "start", "-a", "android.intent.action.SET_TIMER",
      "--ei", "android.intent.extra.alarm.LENGTH", String(seconds),
      "--ez", "android.intent.extra.alarm.SKIP_UI", "true",
      "-e", "android.intent.extra.alarm.MESSAGE", message,
    ]);
  }

  // --- Admin -----------------------------------------------------------------

  install(apkPath: string) {
    return this.run(["install", "-r", apkPath]) as Promise<string>;
  }
  uninstall(pkg: string) {
    return this.run(["uninstall", pkg]) as Promise<string>;
  }
  clearAppData(pkg: string) {
    return this.shell(["pm", "clear", pkg]);
  }
  rawShell(cmd: string) {
    // Caller gates this behind ANDROID_ALLOW_SHELL. Passed as a single shell string on purpose.
    return this.run(["shell", cmd]) as Promise<string>;
  }
}
