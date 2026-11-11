# Security

`mcp-android` drives a connected Android device through the `adb` CLI on behalf
of an AI agent. Treat it like any other privileged automation and grant it least
access.

## Principles

- **Start read-only.** Leave `ANDROID_MODE=read-only` until you need to control
  the device. Tools above the current mode are never registered, so an agent in
  read-only mode cannot tap, type, launch, install, or run shell commands.
- **Destructive ops need a second opt-in.** `install_apk`, `uninstall_app`, and
  `clear_app_data` require `admin` mode **and** `ANDROID_ALLOW_INSTALL=true`.
  `run_shell` (arbitrary `adb shell`) requires `admin` mode **and**
  `ANDROID_ALLOW_SHELL=true`, and is not even registered without that flag.
- **Interactive confirmation.** When the connected client supports MCP
  elicitation, every destructive op (`uninstall_app`, `clear_app_data`,
  `install_apk`, `run_shell`) pauses and asks the **human** to approve the exact
  action before it runs. The model cannot approve on the user's behalf. When the
  client can't elicit, the policy gate above is the control.
- **Require a human for destructive ops.** Set `ANDROID_REQUIRE_HUMAN_APPROVAL=true` so
  `install_apk`, `uninstall_app`, `clear_app_data` and `run_shell` are refused when the client cannot
  show an approval prompt. Each approval is bound to the exact tool and arguments (fingerprint) and to
  a version token read before the prompt and again after the answer; if it changed, the action is
  refused. The tokens: `uninstall_app` / `clear_app_data` — installed versionName + versionCode,
  first-install and last-update time, and the device serial + OS build (not the app's data, which
  changes constantly); `install_apk` — the APK file's size, mtime and inode, plus the device;
  `run_shell` — the device serial + OS build only (the command text is the action). A prompt nobody
  answers is a refusal. Approval receipts are written to the audit log (`"audit":"approval"`, with
  `approvedBy` = `human` or `flag-only`).
- **Package names are validated.** Package names are rejected unless they are plain dotted
  identifiers before they reach `adb shell`, which hands its arguments to the device's shell.
- **Protected packages are read-only forever.** Add critical packages to
  `ANDROID_PROTECTED_PACKAGES` (defaults: settings, systemui, gms) so they can be
  launched and inspected but never uninstalled or data-cleared, regardless of
  mode. Use `ANDROID_PACKAGE_ALLOWLIST` to pin scope to exactly the packages you
  intend.
- **No shell injection.** Every adb invocation passes an argument array (not a
  shell string), so device text, URLs, and element content can't inject commands.
  The one exception, `run_shell`, is explicitly gated behind `ANDROID_ALLOW_SHELL`.
- **Scope with the device's own debugging authorization.** The flags are defence
  in depth; only authorize computers you trust for USB/wireless debugging, and
  revoke the authorization when done.
- **Preview with dry-run.** `ANDROID_DRY_RUN=true` validates and logs write/admin
  intent without touching the device.
- **Keep the audit log on.** `ANDROID_AUDIT_LOG=true` (default) writes a JSON line
  per guarded operation to stderr. stdout is reserved for the MCP protocol.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository rather than a
public issue.
