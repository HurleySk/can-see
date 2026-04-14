# can-see

MCP server that lets AI agents **see** and **interact** with terminal/CLI applications through virtual terminals and PNG screenshots.

Built for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and any MCP-compatible agent.

## Why?

Some things are easier to show than describe. When debugging a TUI app, an interactive CLI wizard, or anything with visual terminal output, `can-see` lets the agent see exactly what you see — colors, layout, cursor position, and all.

## How it works

1. **Launch** a CLI app in a virtual terminal ([node-pty](https://github.com/nickg/node-pty) + [@xterm/headless](https://github.com/nickg/xterm.js))
2. **Screenshot** the terminal as a PNG image (rendered via [node-canvas](https://github.com/nickg/node-canvas))
3. **Send keys/text** to interact with the app
4. **Screenshot** again to see the result
5. **Close** the session when done

## Installation

```bash
npm install -g can-see
```

### Prerequisites

`can-see` depends on [node-canvas](https://github.com/nickg/node-canvas) (Cairo) and [node-pty](https://github.com/nickg/node-pty), which require native compilation. Most systems will need:

- **Windows:** Visual Studio Build Tools (C++ workload) — `npm install --global windows-build-tools` or install from Visual Studio Installer
- **macOS:** Xcode Command Line Tools — `xcode-select --install`
- **Linux:** `sudo apt install build-essential libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev librsvg2-dev`

## Configuration

### Claude Code

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "can-see": {
      "command": "npx",
      "args": ["-y", "can-see"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "can-see": {
      "command": "can-see"
    }
  }
}
```

### Other MCP clients

`can-see` uses stdio transport. Point your MCP client at the `can-see` binary or `npx -y can-see`.

## Tools

| Tool | Description |
|------|-------------|
| `launch` | Start a CLI app in a virtual terminal. Returns a `sessionId`. |
| `screenshot` | Capture the terminal as a PNG image. |
| `send_keys` | Send keystrokes (e.g., `Enter`, `Ctrl+C`, `['Down', 'Down', 'Enter']`). |
| `send_text` | Type a string of text into the app. |
| `list_sessions` | List all active terminal sessions. |
| `close` | Kill the app and clean up. **Always close when done.** |

### Supported keys

`Enter`, `Tab`, `Escape`, `Backspace`, `Space`, `Up`, `Down`, `Left`, `Right`, `Home`, `End`, `Delete`, `PageUp`, `PageDown`, `Ctrl+A` through `Ctrl+Z`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_COLS` | `120` | Terminal width in columns |
| `DEFAULT_ROWS` | `30` | Terminal height in rows |
| `IDLE_TIMEOUT_MS` | `300000` | Auto-close idle sessions after this many ms (5 min) |

## Example usage

From an MCP-connected agent:

```
Agent: I'll launch your app to see what's happening.
→ launch("node", ["app.js"])  → sessionId: "abc-123"

Agent: Let me take a screenshot to see the current state.
→ screenshot("abc-123")  → [PNG image of terminal]

Agent: I can see the menu. Let me select option 2.
→ send_keys("abc-123", ["Down", "Enter"])

Agent: Let me check the result.
→ screenshot("abc-123")  → [PNG image showing result]

Agent: Done, closing the session.
→ close("abc-123")
```

## License

MIT
