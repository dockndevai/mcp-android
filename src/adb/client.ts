/**
 * Thin wrapper over the `adb` CLI. Each method shells out with an argument
 * array (no shell string), so device text/URLs can't inject commands.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { AndroidConnection } from "../config.js";

export class AdbError extends Error {}

/**
 * `adb shell <args…>` joins its arguments into one string for the device's shell, so a package name
 * is only safe to pass if it cannot carry shell syntax. Android package names are dot-separated
 * Java identifiers; reject anything else before it reaches a device shell (or a version probe,
 * which runs BEFORE the human is asked).
 */
const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
function assertPackageName(pkg: string): void {
  if (!PACKAGE_NAME.test(pkg)) throw new AdbError(`Invalid package name: ${JSON.stringify(pkg)}`);
}

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

  // --- Version tokens (pinned across an approval prompt) ------------------------

  /**
   * Which device and which OS build this client is talking to: adb serial + `ro.build.fingerprint`.
   * Catches "a different phone was plugged in while the prompt was open". It does not change on
   * reboot or app activity; only an OS update or a different device changes it.
   */
  async deviceIdentity(): Promise<string> {
    const serial = ((await this.run(["get-serialno"])) as string).trim();
    const build = (await this.shell(["getprop", "ro.build.fingerprint"])).trim();
    return `${serial}|${build}`;
  }

  /**
   * Version token for an installed package: versionName, versionCode, firstInstallTime and
   * lastUpdateTime from `dumpsys package` (all change only on install/update/reinstall), plus the
   * device identity. `undefined` if the package is not installed. It does NOT cover the app's data:
   * data written while the human is deciding is not detected, so a `clear_app_data` approval pins
   * "this build of this app on this device", not "this exact data".
   */
  async packageVersion(pkg: string): Promise<string | undefined> {
    assertPackageName(pkg);
    const out = await this.shell(["dumpsys", "package", pkg]);
    const pick = (key: string, toEol = false): string | undefined =>
      out.match(new RegExp(`^\\s*${key}=(${toEol ? ".+" : "\\S+"})`, "m"))?.[1]?.trim();
    const versionCode = pick("versionCode");
    if (!versionCode) return undefined;
    const name = pick("versionName") ?? "?";
    const detail = [pick("firstInstallTime", true), pick("lastUpdateTime", true), await this.deviceIdentity()].join("|");
    const digest = createHash("sha256").update(detail).digest("hex").slice(0, 8);
    return `${name} (${versionCode}) #${digest}`;
  }

  /**
   * Version token for a file on this computer: size + mtime + inode, plus the device identity (an
   * APK approved for one phone is not approved for another). `undefined` if the file does not
   * exist. A file replaced in place with the same size, mtime and inode is not detected.
   */
  async apkVersion(path: string): Promise<string | undefined> {
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
    const digest = createHash("sha256").update(await this.deviceIdentity()).digest("hex").slice(0, 8);
    return `${s.size}B mtime=${Math.trunc(s.mtimeMs)} ino=${s.ino} #${digest}`;
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
    assertPackageName(pkg);
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
    assertPackageName(pkg);
    return this.run(["uninstall", pkg]) as Promise<string>;
  }
  clearAppData(pkg: string) {
    assertPackageName(pkg);
    return this.shell(["pm", "clear", pkg]);
  }
  rawShell(cmd: string) {
    // Caller gates this behind ANDROID_ALLOW_SHELL. Passed as a single shell string on purpose.
    return this.run(["shell", cmd]) as Promise<string>;
  }
}
