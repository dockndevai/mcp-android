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
- **Device-shell injection is closed, with one deliberate exception.** `adb shell` does not run a
  program with an argument list: it joins its arguments into one string that the device's shell parses,
  so `;`, `|`, `$(…)`, backticks, quotes and newlines in an argument would be executed. Every tool that
  reaches the device shell (`tap`, `swipe`, `input_text`, `press_key`, `launch_app`, `open_url`,
  `set_alarm`, `set_timer`, `clear_app_data`, the read tools) builds its command with one shared helper
  (`src/adb/shell.ts`) that single-quotes each argument and hands adb exactly one string; `uninstall_app`
  and `install_apk` do not use the device shell at all (argument array; the APK path is made absolute so
  it cannot be read as an adb option). Free text (`input_text`, alarm/timer messages) and URLs are
  therefore always data. The tests run the exact string handed to adb through a real POSIX `sh` and
  check that payloads such as `a; rm -rf /sdcard/x`, `$(id)` and backticks arrive as a single literal
  argument and run nothing. Numbers must be integers and keycodes must be `KEYCODE_*` names or digits.
  The one exception is `run_shell`, which runs your string on the device by design and is gated behind
  `admin` mode + `ANDROID_ALLOW_SHELL` (and human approval).
  This guarantee is about the command line: it does not make the *content* harmless, e.g. text typed into
  a focused field goes where the focus is.
- **`open_url` only opens allow-listed schemes.** `http`, `https`, `tel`, `mailto`, `geo` and `market`;
  anything else (`file:`, `content:`, `intent:`, `javascript:`, `sms:`, …) is refused, as is a URL with
  control characters. Add schemes you need with `ANDROID_EXTRA_URL_SCHEMES=scheme1,scheme2` (an operator
  decision, not something the agent can change).
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
