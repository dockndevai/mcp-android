import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

/**
 * Admin tools: only in admin mode. install/uninstall/clear need ANDROID_ALLOW_INSTALL;
 * run_shell needs ANDROID_ALLOW_SHELL (and isn't even registered without it).
 */
export const adminTools: ToolDef[] = [
  {
    name: "install_apk",
    capability: "admin",
    config: {
      title: "Install APK",
      description: "Install (or update) an APK from a local path. Requires admin mode AND ANDROID_ALLOW_INSTALL=true.",
      inputSchema: { apkPath: z.string().describe("Path to a .apk on this machine") },
    },
    handler: async (a, { client, policy, confirm }) => {
      const { dryRun } = policy.guard({ tool: "install_apk", capability: "admin", requiresInstall: true });
      if (dryRun) return textResult(`[dry-run] Would install ${a.apkPath}.`);
      const apkPath = a.apkPath as string;
      const ok = await confirm.confirm({
        action: "install APK",
        target: apkPath,
        probe: () => client.apkVersion(apkPath),
      });
      if (!ok.approved) return textResult(`Cancelled: install_apk was ${ok.reason}.`);
      return textResult((await client.install(a.apkPath as string)).trim());
    },
  },
  {
    name: "uninstall_app",
    capability: "admin",
    config: {
      title: "Uninstall app",
      description: "Uninstall a package. Requires admin mode AND ANDROID_ALLOW_INSTALL=true. Protected packages refused. Irreversible.",
      inputSchema: { package: z.string() },
    },
    handler: async (a, { client, policy, confirm }) => {
      const pkg = a.package as string;
      const { dryRun } = policy.guard({ tool: "uninstall_app", capability: "admin", pkg, destructive: true, requiresInstall: true });
      if (dryRun) return textResult(`[dry-run] Would uninstall ${pkg}.`);
      const ok = await confirm.confirm({
        action: "uninstall app",
        target: pkg,
        probe: () => client.packageVersion(pkg),
      });
      if (!ok.approved) return textResult(`Cancelled: uninstall_app was ${ok.reason}.`);
      return textResult((await client.uninstall(pkg)).trim());
    },
  },
  {
    name: "clear_app_data",
    capability: "admin",
    config: {
      title: "Clear app data",
      description: "Wipe an app's data (like a factory reset of that app). Requires admin + ANDROID_ALLOW_INSTALL. Protected packages refused. Irreversible.",
      inputSchema: { package: z.string() },
    },
    handler: async (a, { client, policy, confirm }) => {
      const pkg = a.package as string;
      const { dryRun } = policy.guard({ tool: "clear_app_data", capability: "admin", pkg, destructive: true, requiresInstall: true });
      if (dryRun) return textResult(`[dry-run] Would clear data for ${pkg}.`);
      const ok = await confirm.confirm({
        action: "clear app data",
        target: pkg,
        probe: () => client.packageVersion(pkg),
      });
      if (!ok.approved) return textResult(`Cancelled: clear_app_data was ${ok.reason}.`);
      return textResult((await client.clearAppData(pkg)).trim());
    },
  },
  {
    name: "run_shell",
    capability: "admin",
    enabledWhen: (p) => p.shellEnabled,
    config: {
      title: "Run adb shell",
      description: "Run an arbitrary `adb shell` command. Very powerful — requires admin mode AND ANDROID_ALLOW_SHELL=true.",
      inputSchema: { command: z.string().describe("Shell command, e.g. 'dumpsys battery'") },
    },
    handler: async (a, { client, policy, confirm }) => {
      const { dryRun } = policy.guard({ tool: "run_shell", capability: "admin", requiresShell: true });
      if (dryRun) return textResult(`[dry-run] Would run: ${a.command}`);
      const command = a.command as string;
      // The command text is the action (shown in full and fingerprinted); the only state to pin is which device it runs on.
      const ok = await confirm.confirm({
        action: "run adb shell command",
        target: command,
        probe: () => client.deviceIdentity(),
      });
      if (!ok.approved) return textResult(`Cancelled: run_shell was ${ok.reason}.`);
      const out = await client.rawShell(a.command as string);
      return textResult(out.length > 40000 ? out.slice(0, 40000) + "\n… (truncated)" : out);
    },
  },
];
