# can-see: Terminal Vision for Claude Code

**Date:** 2026-04-14
**Status:** Draft

## Problem

When developing Node.js interactive TUI apps (ink, inquirer, blessed, ora), visual and interaction bugs are difficult to describe in text. Developers can see the issue on screen but hit a wall trying to communicate it to Claude Code. An image would be worth a thousand words — but Claude Code has no eyes on the terminal.

## Solution

An MCP server that lets Claude Code launch Node.js CLI apps inside virtual terminals, capture the terminal state as PNG screenshots, and send keystrokes to interact with the app. Claude's vision capability interprets the screenshots directly.

## MCP Tools

### `launch`

Start a CLI app in a virtual terminal.

**Params:**
- `command` (string, required) — The command to run (e.g., `"node"`, `"npx"`)
- `args` (string[], optional) — Command arguments (e.g., `["my-app.js", "--verbose"]`)
- `cwd` (string, optional) — Working directory. Defaults to the server's cwd.
- `cols` (number, optional) — Terminal columns. Default: 120.
- `rows` (number, optional) — Terminal rows. Default: 30.

**Returns:** `{ sessionId: string }`

### `screenshot`

Capture the current terminal state as a PNG image.

**Params:**
- `sessionId` (string, required)

**Returns:** PNG image as base64-encoded content (MCP image content type). If the session has exited, returns the final terminal state plus exit code and signal info in a text content block alongside the image.

### `send_keys`

Send keystrokes to the app.

**Params:**
- `sessionId` (string, required)
- `keys` (string | string[], required) — Key(s) to send

**Key notation:**
- Printable text: `"hello"` — sent as-is
- Special keys: `"Enter"`, `"Tab"`, `"Escape"`, `"Backspace"`, `"Space"`
- Arrow keys: `"Up"`, `"Down"`, `"Left"`, `"Right"`
- Ctrl combos: `"Ctrl+C"`, `"Ctrl+D"`, `"Ctrl+Z"`
- Arrays: `["Down", "Down", "Enter"]` — sent in order

The session manager translates key names to the corresponding ANSI escape sequences before writing to the pty.

### `send_text`

Type a string of text into the app.

**Params:**
- `sessionId` (string, required)
- `text` (string, required) — Text to type

Convenience wrapper — equivalent to `send_keys` with a printable string, but makes intent clearer in tool calls.

### `list_sessions`

List all active sessions and their status.

**Params:** None

**Returns:** Array of `{ sessionId, command, args, status, cols, rows, createdAt }` where status is `"running"` or `"exited"`.

### `close`

Kill the app and clean up the session.

**Params:**
- `sessionId` (string, required)

Sends SIGTERM to the process, waits briefly, then SIGKILL if needed. Cleans up the pty and xterm.js instance.

## Architecture

```
Claude Code  <--stdio-->  MCP Server
                            |
                     Session Manager
                       /          \
                  Session 1     Session 2
                  [node-pty]    [node-pty]
                  [xterm.js]    [xterm.js]
                      |             |
                  your-app      other-app
```

### Layer 1: MCP Server

- Built with `@modelcontextprotocol/sdk`
- Stdio transport — Claude Code spawns it directly, no daemon or port needed
- Stateless request handling; all state lives in the Session Manager

### Layer 2: Session Manager

- Maps `sessionId` (UUID) to Session objects
- Each session owns a `node-pty` pseudoterminal and a headless `xterm.js` Terminal instance
- The pty output stream feeds into xterm.js, which processes all ANSI escape sequences and maintains the screen buffer in memory
- Sessions are independent — multiple apps can run simultaneously
- Idle timeout: sessions auto-close after 5 minutes of no interaction (configurable via `IDLE_TIMEOUT_MS` env var)

### Layer 3: Renderer

- On `screenshot`, iterates over the xterm.js terminal buffer row by row, cell by cell, reading each cell's character, foreground color, background color, and attributes (bold, italic, underline, inverse)
- Creates a `node-canvas` Canvas sized to fit the terminal grid (cols * cell_width, rows * cell_height)
- Draws each cell: fill background color, draw character in monospace font with foreground color, apply attribute styling
- Draws a visible cursor (block or underline) at the cursor position
- Produces a PNG image and returns it as base64 in the MCP response using the image content type

**Key detail:** xterm.js runs headless — no browser, no Electron. It maintains terminal state in memory only. The `node-canvas` package handles rasterization without any display server.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| App crashes / exits | Session marked as `exited` with exit code. `screenshot` returns final terminal state + exit info. |
| App hangs | Idle timeout kills the session. `Ctrl+C` available via `send_keys`. User can also `close` explicitly. |
| Invalid sessionId | MCP error: "Session not found: {id}" |
| Launch failure | MCP error with underlying message (command not found, permission denied, etc.) |
| node-pty spawn failure | MCP error with OS-level error message |

## Configuration

Add to Claude Code MCP config (`.mcp.json` in project root or global config):

```json
{
  "mcpServers": {
    "can-see": {
      "command": "node",
      "args": ["path/to/can-see/server.js"],
      "env": {
        "DEFAULT_COLS": "120",
        "DEFAULT_ROWS": "30",
        "IDLE_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework |
| `node-pty` | Pseudoterminal — spawns apps with full PTY support |
| `@xterm/headless` | Headless terminal emulator — processes ANSI sequences, maintains screen buffer |
| `canvas` (node-canvas) | Server-side canvas rendering — rasterizes terminal buffer to PNG |
| `uuid` | Session ID generation |

## Typical Workflow

1. User: "My menu is broken — the highlight jumps to the wrong item when I press Down"
2. Claude Code calls `launch({ command: "node", args: ["my-app.js"] })`
3. Claude Code calls `screenshot({ sessionId })` — sees the initial menu state
4. Claude Code calls `send_keys({ sessionId, keys: "Down" })`
5. Claude Code calls `screenshot({ sessionId })` — sees where the highlight moved
6. Claude Code identifies the visual bug from the before/after screenshots
7. Claude Code calls `close({ sessionId })` and goes to fix the code

## Scope Boundaries

**In scope:**
- Launching Node.js CLI apps in virtual terminals
- Capturing terminal state as PNG screenshots
- Sending keystrokes and text input
- Multiple concurrent sessions
- Works on Windows, macOS, Linux (node-pty handles platform differences)

**Out of scope:**
- Streaming/live video of terminal output
- Browser-based viewer for the terminal
- Structured telemetry or log parsing
- Integration with anything other than Claude Code (though MCP is inherently portable)
- Mouse input support (keyboard only for v1)
