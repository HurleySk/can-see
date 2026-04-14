# can-see v0.3.0 — Advanced Terminal Observation Tools

## Overview

Add 8 new MCP tools to can-see that eliminate guesswork in terminal debugging: diff screenshots, region capture, color/text assertions, scroll buffer access, GIF recording, and wait-for-color. These tools complement the existing 9 tools (launch, screenshot, read_text, wait_for_text, wait_for_idle, send_keys, send_text, list_sessions, close) to give agents precise, programmatic control over terminal observation.

**Target version:** 0.3.0 (minor bump — new features, backward compatible)

## New Tools Summary

| Tool | Description |
|------|-------------|
| `screenshot_region` | Capture a specific rectangular area of the visible terminal |
| `capture_baseline` | Snapshot current terminal state for later diff comparison |
| `diff_screenshot` | Compare current state against baseline, return highlighted overlay PNG |
| `get_cell_info` | Query character, colors, and attributes at specific cell(s) |
| `read_scrollback` | Read text that has scrolled above the visible viewport |
| `start_recording` | Begin capturing terminal frames for animated GIF |
| `stop_recording` | Stop recording and return animated GIF |
| `wait_for_color` | Block until a specific color appears at a position |

## Architecture

### New Files

| File | Responsibility |
|------|----------------|
| `src/colors.ts` | Shared color resolution utilities (extracted from renderer.ts) |
| `src/diff.ts` | Buffer snapshot capture and cell-by-cell comparison |
| `src/recorder.ts` | GIF recording state machine (output-triggered frame capture) |

### Modified Files

| File | Changes |
|------|---------|
| `src/renderer.ts` | Accept optional `RenderOptions` (region bounds, highlight overlay) |
| `src/session.ts` | Add `screenshotRegion()`, `getScrollbackText()`, `getCellInfo()`, baseline/recorder state |
| `src/server.ts` | Register 8 new tools |
| `tests/server.test.ts` | Integration tests for new tools |
| `package.json` | Add `gifenc` dependency, bump to 0.3.0 |
| `server.json` | Bump to 0.3.0 |
| `README.md` | Document new tools |
| `CLAUDE.md` | Update tool count (9 → 17) |

### New Dependency

**`gifenc`** — Pure JS animated GIF encoder. Chosen over alternatives because:
- No native dependencies (unlike `gif.js` which uses Web Workers)
- Small footprint, synchronous API
- Supports per-frame delays and palette quantization

---

## Feature 1: Region Capture (`screenshot_region`)

### Tool Signature

```
screenshot_region(sessionId, startRow, startCol, endRow, endCol)
→ PNG image of the specified rectangular area
```

**Parameters:**
- `sessionId: string` — required
- `startRow: number` — top row, 0-based, viewport-relative (default: 0)
- `startCol: number` — left column, 0-based (default: 0)
- `endRow: number` — bottom row, exclusive (default: terminal.rows)
- `endCol: number` — right column, exclusive (default: terminal.cols)

**Coordinates are viewport-relative** — row 0 is the top visible line, not the start of scrollback. This keeps the API simple and predictable.

### Renderer Refactoring

`renderTerminal()` gains an optional `RenderOptions` parameter:

```typescript
interface RenderOptions {
  startRow?: number;
  endRow?: number;
  startCol?: number;
  endCol?: number;
  highlights?: Map<string, string>; // "row,col" → CSS color for overlay
}
```

- Canvas dimensions adjust to region size: `(endCol - startCol) * CELL_WIDTH + 2 * PADDING` by `(endRow - startRow) * CELL_HEIGHT + 2 * PADDING`
- Cell rendering loop iterates only within bounds
- Pixel positions offset: `x = PADDING + (col - startCol) * CELL_WIDTH`
- Cursor drawn only if within region
- Highlight overlays drawn as semi-transparent rectangles after cell rendering

The existing `renderTerminal(terminal)` call (no options) behaves identically to today — full viewport, no highlights.

### Session Method

```typescript
screenshotRegion(startRow: number, startCol: number, endRow: number, endCol: number): Buffer
```

Validates bounds against terminal dimensions, delegates to parameterized `renderTerminal()`.

---

## Feature 2: Diff Screenshots (`capture_baseline` + `diff_screenshot`)

### Tool Signatures

```
capture_baseline(sessionId)
→ "Baseline captured (120x30, 3600 cells)"

diff_screenshot(sessionId)
→ PNG with changed cells highlighted in red overlay + text "42 cells changed in rows 3-15"
```

### Baseline Capture

A baseline is a cell-by-cell snapshot of the current viewport state. Stored as a 2D array of `CellSnapshot`:

```typescript
interface CellSnapshot {
  char: string;
  fg: string;    // resolved hex color
  bg: string;    // resolved hex color
  bold: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}
```

**When baselines are captured:**
- Explicitly via `capture_baseline` tool
- Automatically as a side-effect of `screenshot` (the existing tool) — every screenshot also updates the baseline

**Storage:** `Session` gains `private baseline?: CellSnapshot[][]`. One baseline per session. Subsequent captures replace the previous one.

### Diff Comparison (`src/diff.ts`)

```typescript
function captureBuffer(terminal: Terminal): CellSnapshot[][]
function diffBuffers(before: CellSnapshot[][], after: CellSnapshot[][]): DiffResult

interface DiffResult {
  highlights: Map<string, string>;  // "row,col" → "#ff000080" (red, 50% alpha)
  changedCells: number;
  changedRowRange: [number, number]; // [minRow, maxRow]
}
```

- Compares char, fg, bg per cell (ignoring attribute-only changes like bold — too noisy)
- Returns highlight map compatible with `RenderOptions.highlights`
- Changed cells get `#ff000080` (semi-transparent red) overlay

### Tool Behavior

- `diff_screenshot` with no baseline returns an error: `"No baseline captured. Call capture_baseline or screenshot first."`
- After returning the diff, the baseline is **not** reset — agent can diff multiple times against the same baseline
- Agent must explicitly call `capture_baseline` or `screenshot` to set a new baseline

---

## Feature 3: Color/Text Assertions (`get_cell_info`)

### Tool Signature

```
get_cell_info(sessionId, row, col, endCol?)
→ single cell or array of cells with full attribute info
```

**Parameters:**
- `sessionId: string` — required
- `row: number` — 0-based, viewport-relative
- `col: number` — 0-based column
- `endCol: number` — optional, exclusive end column for range query

**Response (single cell):**
```json
{
  "char": "E",
  "fg": "#ff0000",
  "bg": "#1e1e1e",
  "bold": true,
  "italic": false,
  "underline": false,
  "inverse": false,
  "dim": false,
  "strikethrough": false
}
```

**Response (range, when endCol provided):**
```json
{
  "text": "ERROR",
  "cells": [
    { "char": "E", "fg": "#ff0000", "bg": "#1e1e1e", "bold": true, ... },
    { "char": "R", "fg": "#ff0000", "bg": "#1e1e1e", "bold": true, ... },
    ...
  ]
}
```

### Color Resolution

All colors returned as hex strings (`"#rrggbb"`):
- Default fg → `"#cccccc"`
- Default bg → `"#1e1e1e"`
- Palette colors → resolved via `paletteColor()` then converted to hex
- RGB colors → converted via `rgbColor()` then formatted as hex

### Shared Color Utilities (`src/colors.ts`)

Extract from `renderer.ts`:
- `ANSI_COLORS` array (16 standard colors)
- `paletteColor(index: number): string` — returns CSS color string
- `rgbColor(value: number): string` — returns CSS color string
- `DEFAULT_FG`, `DEFAULT_BG` constants
- New: `resolveColor(cell, type: "fg" | "bg"): string` — unified helper that checks default/palette/RGB and returns hex

Both `renderer.ts` and `get_cell_info` logic import from `colors.ts`.

---

## Feature 4: Scroll Buffer Access (`read_scrollback`)

### Tool Signature

```
read_scrollback(sessionId, lines?)
→ plain text from scrollback history
```

**Parameters:**
- `sessionId: string` — required
- `lines: number` — optional, how many lines from the bottom of scrollback to return (default: 100)

### Implementation

```typescript
// In session.ts
getScrollbackText(lines: number = 100): string {
  const buffer = this.terminal.buffer.active;
  const scrollbackEnd = buffer.baseY; // first viewport line
  if (scrollbackEnd === 0) return ""; // no scrollback

  const start = Math.max(0, scrollbackEnd - lines);
  const result: string[] = [];
  for (let i = start; i < scrollbackEnd; i++) {
    const line = buffer.getLine(i);
    if (line) result.push(line.translateToString(true));
  }
  return result.join("\n");
}
```

**Edge cases:**
- `baseY === 0` → return empty string + text note "No scrollback content available"
- `lines` > available scrollback → return all available, no error
- Updates `lastActivity` (prevents idle reaping during long reads)

---

## Feature 5: GIF Recording (`start_recording` / `stop_recording`)

### Tool Signatures

```
start_recording(sessionId, minIntervalMs?, maxDurationMs?)
→ "Recording started (output-triggered, min interval 100ms, max 60s)"

stop_recording(sessionId)
→ base64 animated GIF image
```

**Parameters:**
- `minIntervalMs: number` — minimum gap between frames (default: 100ms)
- `maxDurationMs: number` — auto-stop safety limit (default: 60000ms / 60s)

### Recording Approach: Output-Triggered with Debounce

Frames are captured when PTY output arrives, not on a fixed timer:

1. `start_recording` attaches a `Recorder` to the session
2. Recorder hooks into the PTY output event (same `ptyProcess.onData` path)
3. On output: if `>= minIntervalMs` since last frame, capture immediately. Otherwise, schedule capture after the remaining debounce time.
4. Frame capture: call `renderTerminal()` → extract raw RGBA pixel data from canvas
5. On `stop_recording`: encode all frames with `gifenc`, using actual elapsed time between frames as delay values

**Why output-triggered:**
- No wasted frames during idle periods → smaller GIFs
- Captures actual state changes → better visual quality
- Frame delays match real timing → natural playback speed

### Recorder Class (`src/recorder.ts`)

```typescript
class Recorder {
  private frames: { pixels: Uint8Array, delay: number }[] = [];
  private lastFrameTime: number = 0;
  private startTime: number;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped: boolean = false;

  constructor(
    private terminal: Terminal,
    private minIntervalMs: number,
    private maxDurationMs: number,
    private onAutoStop: () => void,
  ) {}

  onOutput(): void { /* debounced frame capture */ }
  captureFrame(): void { /* renderTerminal → extract pixels → store */ }
  stop(): Buffer { /* encode GIF, return buffer */ }
  dispose(): void { /* cleanup timers */ }
}
```

### Session Integration

- `Session` gains `private recorder?: Recorder`
- `Session.ptyProcess.onData` handler calls `this.recorder?.onOutput()` when recorder is attached
- `start_recording` creates recorder, attaches to session via `session.startRecording(minIntervalMs, maxDurationMs)`
- `stop_recording` calls `session.stopRecording()` which finalizes GIF, detaches, returns buffer
- `session.close()` disposes recorder if active
- Recording while a recorder is already active → error "Recording already in progress"

### Memory Safety

- Max 60s recording at 100ms intervals ≈ 600 frames max
- Each frame is raw RGBA (120×30 cells × 9×18px = 1080×540px = ~2.3MB uncompressed)
- Worst case: ~1.4GB for 600 frames — this is too much. **Cap at 300 frames.** If the cap is hit, auto-stop.
- `maxDurationMs` auto-stops recording and returns what was captured (not an error)

### GIF Encoding

Using `gifenc`:
```typescript
import { GIFEncoder, quantize, applyPalette } from "gifenc";

const gif = GIFEncoder();
for (const frame of frames) {
  const palette = quantize(frame.pixels, 256);
  const indexed = applyPalette(frame.pixels, palette);
  gif.writeFrame(indexed, width, height, { palette, delay: frame.delay });
}
gif.finish();
return Buffer.from(gif.bytes());
```

---

## Feature 6: Wait for Color (`wait_for_color`)

### Tool Signature

```
wait_for_color(sessionId, color, row?, col?, target?, timeoutMs?)
→ "Found #ff0000 at row 5, col 12 after 1200ms"
```

**Parameters:**
- `sessionId: string` — required
- `color: string` — hex color to wait for, e.g. `"#ff0000"` or ANSI name `"red"`
- `row: number` — optional, specific row to check (viewport-relative)
- `col: number` — optional, specific column to check
- `target: "fg" | "bg"` — optional, which color to check (default: `"fg"`)
- `timeoutMs: number` — optional (default: 30000)

### Color Matching

**Hex input:** Exact match after resolving cell color to hex via `resolveColor()`.

**ANSI name input:** Supported names map to specific hex values:
```
black → #000000       bright-black → #666666
red → #aa0000         bright-red → #ff5555
green → #00aa00       bright-green → #55ff55
yellow → #aa5500      bright-yellow → #ffff55
blue → #0000aa        bright-blue → #5555ff
magenta → #aa00aa     bright-magenta → #ff55ff
cyan → #00aaaa        bright-cyan → #55ffff
white → #aaaaaa       bright-white → #ffffff
```

These map to the ANSI_COLORS palette indices 0-15 in the renderer.

### Search Behavior

- `row` + `col` specified: check that exact cell each poll
- `row` only: scan all columns in that row
- Neither: scan entire viewport (all rows and columns)
- Returns the first matching position found

### Polling

Same pattern as `wait_for_text`:
- 100ms poll interval
- Early exit on process death
- Updates `lastActivity` each poll iteration

---

## Updated Server Instructions

The `instructions` string in `McpServer` constructor should be updated to mention the new capabilities:

```
Workflow:
1. launch — start the app
2. wait_for_text / wait_for_idle / wait_for_color — wait for the app to be ready
3. screenshot, screenshot_region, or read_text — see what's on screen
4. get_cell_info — check specific colors/attributes if needed
5. send_keys / send_text — interact with the app
6. wait_for_text / wait_for_idle / wait_for_color — wait for the result
7. diff_screenshot — see what changed (if baseline was captured)
8. close — ALWAYS close sessions when done

Use start_recording/stop_recording to capture animated GIF of a workflow.
Use read_scrollback to see output that scrolled off the visible area.
```

---

## Testing Strategy

Each feature gets integration tests via the MCP client/server InMemoryTransport pattern:

| Feature | Tests |
|---------|-------|
| `screenshot_region` | Region returns smaller PNG; invalid bounds error |
| `capture_baseline` + `diff_screenshot` | Diff detects changes; diff with no baseline errors; screenshot auto-captures baseline |
| `get_cell_info` | Returns correct char/color; range query; out-of-bounds error |
| `read_scrollback` | Returns scrollback text; no scrollback returns empty |
| `start_recording` / `stop_recording` | Returns valid GIF; double-start errors; max duration auto-stop |
| `wait_for_color` | Finds color; timeout on missing color; ANSI name matching |

Tests use the existing `echo-app.js` fixture which outputs green `>` prompt (verifiable color).

---

## Version & Publishing

- Bump `package.json`, `server.json`, `src/server.ts` version to `0.3.0`
- Update `README.md` tools table (9 → 17 tools)
- Update `CLAUDE.md` tool count and test count
- `npm publish --access public`
- `mcp-publisher publish` to update official registry
