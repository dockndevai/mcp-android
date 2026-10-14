import { describe, expect, it } from "vitest";
import { PolicyError, SecurityPolicy, type SecurityConfig } from "../src/security.js";

function makePolicy(o: Partial<SecurityConfig> = {}): SecurityPolicy {
  return new SecurityPolicy({
    mode: "read-only",
    packageAllowlist: [],
    protectedPackages: ["com.android.settings"],
    allowInstall: false,
    allowShell: false,
    dryRun: false,
    auditLog: false,
    ...o,
  });
}

describe("capability gating", () => {
  it("read-only enables read only", () => {
    const p = makePolicy();
    expect(p.isCapabilityEnabled("read")).toBe(true);
    expect(p.isCapabilityEnabled("write")).toBe(false);
    expect(p.isCapabilityEnabled("admin")).toBe(false);
  });
  it("rejects tap in read-only", () => {
    expect(() => makePolicy().guard({ tool: "tap", capability: "write" })).toThrow(PolicyError);
  });
});

describe("package allowlist + protection", () => {
  it("blocks packages outside allowlist", () => {
    const p = makePolicy({ mode: "read-write", packageAllowlist: ["com.app"] });
    expect(() => p.guard({ tool: "launch_app", capability: "write", pkg: "com.other" })).toThrow(/allowlist/);
  });
  it("refuses uninstalling a protected package", () => {
    const p = makePolicy({ mode: "admin", allowInstall: true });
    expect(() =>
      p.guard({ tool: "uninstall_app", capability: "admin", pkg: "com.android.settings", destructive: true, requiresInstall: true }),
    ).toThrow(/protected/);
  });
});

describe("install + shell gating", () => {
  it("blocks install without ANDROID_ALLOW_INSTALL", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() => p.guard({ tool: "install_apk", capability: "admin", requiresInstall: true })).toThrow(/ALLOW_INSTALL/);
  });
  it("blocks shell without ANDROID_ALLOW_SHELL", () => {
    const p = makePolicy({ mode: "admin" });
    expect(() => p.guard({ tool: "run_shell", capability: "admin", requiresShell: true })).toThrow(/ALLOW_SHELL/);
  });
  it("shellEnabled needs both admin and the flag", () => {
    expect(makePolicy({ mode: "admin", allowShell: false }).shellEnabled).toBe(false);
    expect(makePolicy({ mode: "read-write", allowShell: true }).shellEnabled).toBe(false);
    expect(makePolicy({ mode: "admin", allowShell: true }).shellEnabled).toBe(true);
  });
});

describe("dry run", () => {
  it("flags writes but not reads", () => {
    const p = makePolicy({ mode: "read-write", dryRun: true });
    expect(p.guard({ tool: "screenshot", capability: "read" }).dryRun).toBe(false);
    expect(p.guard({ tool: "tap", capability: "write" }).dryRun).toBe(true);
  });
});
