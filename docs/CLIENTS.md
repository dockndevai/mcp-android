# Installing `mcp-android` in your MCP client

`mcp-android` is a **stdio** MCP server. Any MCP-compatible agent can run it. Two ways to launch it:

- **From npm (recommended once published):** `npx -y @dockndevai/mcp-android` — no local clone needed.
- **From source:** `node /ABSOLUTE/PATH/TO/mcp-android/dist/index.js` after `npm install && npm run build`.

> The examples below use `npx -y @dockndevai/mcp-android`. To run from source instead, replace `"command": "npx", "args": ["-y", "@dockndevai/mcp-android"]` with `"command": "node", "args": ["/ABSOLUTE/PATH/TO/mcp-android/dist/index.js"]`. **Start in `read-only` mode** and raise it deliberately. See [`.env.example`](../.env.example) for every supported variable.

## Prerequisites

```bash
brew install android-platform-tools   # provides adb (macOS; use your package manager elsewhere)
# On the phone: Settings → Developer options → enable USB (or Wireless) debugging, then authorize this computer
adb devices                            # confirm your device shows "device"
```

## Claude Code (CLI)

```bash
claude mcp add android \
  -e ANDROID_MODE="read-only" \
  -- npx -y @dockndevai/mcp-android
```

Add `-s user` to install it for all your projects, or `-s project` to write it into a shared `.mcp.json`. List with `claude mcp list`, remove with `claude mcp remove android`.

## Claude Desktop

Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`) and merge:

```json
{
  "mcpServers": {
    "android": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-android"],
      "env": {
        "ANDROID_MODE": "read-only"
      }
    }
  }
}
```

Restart Claude Desktop. The server appears under the tools (🔨) menu.

## Cursor

Create `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "android": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-android"],
      "env": {
        "ANDROID_MODE": "read-only"
      }
    }
  }
}
```

Then enable it in **Cursor Settings → MCP**.

## OpenAI Codex CLI

Edit `~/.codex/config.toml` and add:

```toml
[mcp_servers.android]
command = "npx"
args = ["-y", "@dockndevai/mcp-android"]
env = { ANDROID_MODE = "read-only" }
```

Codex reads MCP servers from `config.toml` on startup.

## Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "android": {
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-android"],
      "env": {
        "ANDROID_MODE": "read-only"
      }
    }
  }
}
```

Then **Refresh** in the Windsurf MCP settings panel.

## VS Code (GitHub Copilot / Agent mode)

Create `.vscode/mcp.json` (note the top-level key is `servers`):

```json
{
  "servers": {
    "android": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@dockndevai/mcp-android"],
      "env": {
        "ANDROID_MODE": "read-only"
      }
    }
  }
}
```

Open the Copilot Chat **Agent** view and confirm the server is listed.

## Any other MCP client

Point it at the command `npx -y @dockndevai/mcp-android` (transport: **stdio**) with the same environment variables.

## Verify

On startup the server logs a line to **stderr** like:

```
[android-mcp] Starting in 'read-only' mode. N tools enabled: …
```

If you see `Configuration error: …` instead, fix the reported variable. Ask your agent to *"list the Android tools"* or *"take a screenshot of my phone"* to confirm the connection.
