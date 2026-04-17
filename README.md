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
| `launch` | Start a CLI app in a virtual terminal. Returns a `sessionId`. Accepts optional `env` to set environment variables. |
| `screenshot` | Capture the terminal as a PNG image. |
| `screenshot_region` | Capture a specific rectangular area of the terminal. |
| `screenshot_text_region` | Find text in the viewport and capture the surrounding area as a PNG. |
| `capture_baseline` | Snapshot terminal state for later diff comparison. |
| `diff_screenshot` | Compare current state against baseline with highlighted changes. |
| `get_cell_info` | Query character, colors, and attributes at specific cell(s). Supports `compact` mode for reduced output. |
| `read_text` | Read the terminal buffer as plain text. |
| `read_scrollback` | Read text that scrolled above the visible viewport. |
| `wait_for_text` | Wait until specific text appears in the terminal buffer. |
| `wait_for_idle` | Wait until terminal output has been stable for a given duration. Supports `stableMs` for content-comparison mode (for apps with timers/spinners), `excludeRows` to ignore specific rows, and `excludePattern` (regex) for dynamic row exclusion. |
| `wait_for_color` | Wait until a specific color appears at a position. |
| `wait_for_exit` | Wait until the process exits and return its exit code and signal. |
| `start_recording` | Begin capturing frames for an animated GIF. |
| `stop_recording` | Stop recording and return the animated GIF with metadata (`frameCount`, `durationMs`). Auto-trims frames or saves to file if GIF exceeds inline size limit. |
| `send_keys` | Send keystrokes (e.g., `Enter`, `Ctrl+C`, `['Down', 'Down', 'Enter']`). |
| `send_text` | Type a string of text into the app. |
| `get_process_status` | Get process status — distinguish "app is idle" from "app has exited". Returns PID, running state, exit code. |
| `list_sessions` | List all active terminal sessions. |
| `close` | Kill the app and clean up. **Always close when done.** |
| `close_all` | Kill all active sessions at once. Useful for cleanup between test runs. |

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

Agent: Let me wait for the app to start.
→ wait_for_text("abc-123", "Ready")  → Found "Ready" after 1200ms

Agent: Let me read the current output.
→ read_text("abc-123")  → "Welcome to MyApp\nReady\n> "

Agent: I can see the prompt. Let me select option 2.
→ send_keys("abc-123", ["Down", "Enter"])

Agent: Waiting for the screen to settle.
→ wait_for_idle("abc-123")  → Terminal idle for 520ms

Agent: Let me check the result.
→ screenshot("abc-123")  → [PNG image showing result]

Agent: Done, closing the session.
→ close("abc-123")
```

## Changelog

### 0.5.0

**New tools:**
- `wait_for_exit` — wait for process exit, get exit code and signal
- `close_all` — kill all active sessions at once
- `get_process_status` — distinguish "app is idle" from "app has exited"
- `screenshot_text_region` — find text in viewport, capture surrounding area as PNG

**Enhancements:**
- `launch` accepts `env` parameter for custom environment variables
- `wait_for_idle` supports `excludePattern` (regex) for dynamic row exclusion in stableMs mode
- `stop_recording` returns `frameCount` and `durationMs` metadata alongside GIF
- `get_cell_info` supports `compact` option for reduced output (`{char, fg, bold}` only)

**Bug fixes:**
- Fixed `wait_for_text` and `wait_for_color` race condition where text/color present in the final buffer was missed when the process exited simultaneously
- Added mutual exclusion validation when both `stableMs` and `idleMs` are passed to `wait_for_idle`

## License

MIT
