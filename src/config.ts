/**
 * Configuration from environment variables. The server drives a connected
 * Android device through the `adb` CLI (USB or wireless debugging).
 */
import { parseUrlSchemes } from "./adb/shell.js";
import type { AccessMode, SecurityConfig } from "./security.js";

export interface AndroidConnection {
  /** Path to the adb binary. */
  adbPath: string;
  /** Target device serial (from `adb devices`). Empty = the only connected device. */
  serial?: string;
  /** Per-command timeout (ms). */
  timeout: number;
  /** URL schemes `open_url` accepts in addition to http, https, tel, mailto, geo, market. */
  extraUrlSchemes?: string[];
}

export interface AppConfig {
  connection: AndroidConnection;
  security: SecurityConfig;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function list(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseMode(): AccessMode {
  const raw = (process.env.ANDROID_MODE ?? "read-only").toLowerCase();
  if (raw === "read-only" || raw === "read-write" || raw === "admin") return raw;
  throw new Error(`Invalid ANDROID_MODE '${raw}'. Expected one of: read-only, read-write, admin.`);
}

export function loadConfig(): AppConfig {
  return {
    connection: {
      adbPath: process.env.ANDROID_ADB_PATH || "adb",
      serial: process.env.ANDROID_SERIAL || undefined,
      timeout: Number(process.env.ANDROID_TIMEOUT_MS ?? 20000),
      extraUrlSchemes: parseUrlSchemes(list("ANDROID_EXTRA_URL_SCHEMES")),
    },
    security: {
      mode: parseMode(),
      packageAllowlist: list("ANDROID_PACKAGE_ALLOWLIST"),
      protectedPackages: list("ANDROID_PROTECTED_PACKAGES").length
        ? list("ANDROID_PROTECTED_PACKAGES")
        : ["com.android.settings", "com.android.systemui", "com.google.android.gms"],
      allowInstall: bool("ANDROID_ALLOW_INSTALL", false),
      allowShell: bool("ANDROID_ALLOW_SHELL", false),
      dryRun: bool("ANDROID_DRY_RUN", false),
      auditLog: bool("ANDROID_AUDIT_LOG", true),
      requireHumanApproval: bool("ANDROID_REQUIRE_HUMAN_APPROVAL", false),
    },
  };
}
