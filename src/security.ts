/**
 * Security policy engine (pure, unit-testable) — same shape as the rest of the
 * suite. Decides which tools register for the access mode and gates each call
 * (package scoping, protected packages, install/shell opt-ins, destructive ops,
 * dry-run, audit).
 */
export type Capability = "read" | "write" | "admin";
export type AccessMode = "read-only" | "read-write" | "admin";

const MODE_RANK: Record<AccessMode, number> = { "read-only": 0, "read-write": 1, admin: 2 };
const CAP_RANK: Record<Capability, number> = { read: 0, write: 1, admin: 2 };

export interface SecurityConfig {
  mode: AccessMode;
  /** If set, only these packages may be launched/uninstalled/cleared. Empty = all. */
  packageAllowlist: string[];
  /** Packages that can be inspected/launched but never uninstalled or data-cleared. */
  protectedPackages: string[];
  /** install_apk / uninstall_app require this in addition to admin mode. */
  allowInstall: boolean;
  /** run_shell (arbitrary adb shell) requires this in addition to admin mode. */
  allowShell: boolean;
  /** Validate + log write/admin actions without executing them on the device. */
  dryRun: boolean;
  auditLog: boolean;
}

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export interface GuardContext {
  tool: string;
  capability: Capability;
  /** Target package, if any. */
  pkg?: string;
  /** Destructive (uninstall / clear data) — needs allowInstall gate + protection check. */
  destructive?: boolean;
  requiresInstall?: boolean;
  requiresShell?: boolean;
}

export class SecurityPolicy {
  constructor(private readonly config: SecurityConfig) {}

  get mode(): AccessMode {
    return this.config.mode;
  }
  get shellEnabled(): boolean {
    return this.isCapabilityEnabled("admin") && this.config.allowShell;
  }

  isCapabilityEnabled(c: Capability): boolean {
    return CAP_RANK[c] <= MODE_RANK[this.config.mode];
  }
  isPackageAllowed(pkg: string): boolean {
    if (this.config.packageAllowlist.length === 0) return true;
    return this.config.packageAllowlist.includes(pkg);
  }
  isPackageProtected(pkg: string): boolean {
    return this.config.protectedPackages.includes(pkg);
  }

  guard(ctx: GuardContext): { dryRun: boolean } {
    if (!this.isCapabilityEnabled(ctx.capability)) {
      this.audit(ctx, "DENY", `capability '${ctx.capability}' exceeds mode '${this.config.mode}'`);
      throw new PolicyError(
        `Operation '${ctx.tool}' requires '${ctx.capability}' access but the server runs in '${this.config.mode}' mode.`,
      );
    }
    if (ctx.pkg !== undefined) {
      if (!this.isPackageAllowed(ctx.pkg)) {
        this.audit(ctx, "DENY", `package '${ctx.pkg}' not in allowlist`);
        throw new PolicyError(`Package '${ctx.pkg}' is not in the configured allowlist (ANDROID_PACKAGE_ALLOWLIST).`);
      }
      if (ctx.destructive && this.isPackageProtected(ctx.pkg)) {
        this.audit(ctx, "DENY", `package '${ctx.pkg}' is protected`);
        throw new PolicyError(`Package '${ctx.pkg}' is protected (ANDROID_PROTECTED_PACKAGES); refused.`);
      }
    }
    if (ctx.requiresInstall && !this.config.allowInstall) {
      this.audit(ctx, "DENY", "install not enabled");
      throw new PolicyError(`Operation '${ctx.tool}' is disabled. Set ANDROID_ALLOW_INSTALL=true to enable it.`);
    }
    if (ctx.requiresShell && !this.config.allowShell) {
      this.audit(ctx, "DENY", "shell not enabled");
      throw new PolicyError(`Operation '${ctx.tool}' is disabled. Set ANDROID_ALLOW_SHELL=true to enable raw shell.`);
    }

    const dryRun = ctx.capability !== "read" && this.config.dryRun;
    this.audit(ctx, dryRun ? "DRY_RUN" : "ALLOW");
    return { dryRun };
  }

  private audit(ctx: GuardContext, decision: string, reason?: string): void {
    if (!this.config.auditLog) return;
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        audit: "android-mcp",
        decision,
        tool: ctx.tool,
        capability: ctx.capability,
        pkg: ctx.pkg ?? null,
        destructive: ctx.destructive ?? false,
        ...(reason ? { reason } : {}),
      })}\n`,
    );
  }
}
