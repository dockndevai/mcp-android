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
