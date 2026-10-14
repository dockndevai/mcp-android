# mcp-android

[![CI](https://github.com/dockndevai/mcp-android/actions/workflows/ci.yml/badge.svg)](https://github.com/dockndevai/mcp-android/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@dockndevai/mcp-android.svg)](https://www.npmjs.com/package/@dockndevai/mcp-android)

A [Model Context Protocol](https://modelcontextprotocol.io) server to **control an Android phone over ADB** — the phone equivalent of the Mac-control servers. Claude can see the screen (screenshots + UI hierarchy) and tap, type, press keys, launch apps, set alarms/timers, and read notifications. Safe-by-default, with the suite's access-mode + flag model.

Runs on your computer and drives a phone connected by **USB or wireless debugging** (great for the Z Fold 7). It is **not** installed on the phone and does not need root.

> **iOS?** A stock iPhone can't be controlled this way — Apple's sandbox forbids cross-app/system automation. See the separate **mcp-ios** repo for the realistic (Appium/WebDriverAgent over USB from a Mac) approach.

## Quickstart

```bash
brew install android-platform-tools        # provides adb
# On the phone: Settings → Developer options → enable USB (or Wireless) debugging, then authorize this computer
adb devices                                 # confirm your device shows "device"
```

Run it straight from npm — no clone or build needed:

```bash
npx -y @dockndevai/mcp-android
```

Or add it to Claude Code in one line (start read-only):

```bash
claude mcp add android -e ANDROID_MODE="read-only" -- npx -y @dockndevai/mcp-android
```

See [docs/CLIENTS.md](docs/CLIENTS.md) for Claude Desktop, Cursor, Codex, Windsurf, and VS Code configs.

## Setup from source

```bash
brew install android-platform-tools        # provides adb
adb devices                                 # confirm your device shows "device"
npm install && npm run build
```

## Tools

**Read** (`read-only`+): `list_devices`, `device_info`, `screenshot`, `ui_dump`, `current_app`, `list_apps`, `get_notifications`

**Write** (`read-write`+): `tap`, `swipe`, `input_text`, `press_key`, `launch_app`, `open_url`, `set_alarm`, `set_timer`

**Admin** (`admin`): `install_apk`, `uninstall_app`, `clear_app_data` (need `ANDROID_ALLOW_INSTALL`), `run_shell` (needs `ANDROID_ALLOW_SHELL`; not registered otherwise)

The typical loop for driving the UI: **`screenshot` → `ui_dump` (find bounds) → `tap`/`input_text`**.

## Security model

| Concern | Flag | Default |
| --- | --- | --- |
| What it can do | `ANDROID_MODE` | `read-only` |
| Which packages in scope | `ANDROID_PACKAGE_ALLOWLIST` | *(all)* |
| Protected packages (never uninstall/clear) | `ANDROID_PROTECTED_PACKAGES` | settings, systemui, gms |
| Allow install/uninstall/clear | `ANDROID_ALLOW_INSTALL` | `false` |
| Allow raw `adb shell` | `ANDROID_ALLOW_SHELL` | `false` |
| Interactive confirmation (destructive ops) | MCP elicitation (client-driven) | *(on when the client supports it)* |
| Preview without touching device | `ANDROID_DRY_RUN` | `false` |
| Audit log (stderr) | `ANDROID_AUDIT_LOG` | `true` |

When the connected client supports MCP **elicitation**, destructive tools (`uninstall_app`, `clear_app_data`, `install_apk`, `run_shell`) pause and ask the **human** to approve the exact action before it runs — the model can't approve on your behalf. When the client can't elicit, the access-mode + flag gates above are the control.

## Run with Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "android": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-android/dist/index.js"],
      "env": { "ANDROID_MODE": "read-write" }
    }
  }
}
```

### Example prompts
- *"Take a screenshot of my phone and tell me what's on screen."*
- *"Set an alarm for 6:30am labeled Gym."*
- *"Open the Clock app and start a 10-minute timer."*
- *"What notifications do I have piling up?"*

## Develop

```bash
npm run dev
npm test          # security policy
npm run typecheck
```

## License

MIT
