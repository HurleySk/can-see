#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SessionManager } from "./session-manager.js";
import { resolveKeys } from "./keys.js";
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_IDLE_TIMEOUT_MS } from "./types.js";
import { parseColor } from "./colors.js";
import { diffBuffers } from "./diff.js";

export function createServer(): McpServer {
  const cols = parseInt(process.env.DEFAULT_COLS ?? "", 10) || DEFAULT_COLS;
  const rows = parseInt(process.env.DEFAULT_ROWS ?? "", 10) || DEFAULT_ROWS;
  const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS ?? "", 10) || DEFAULT_IDLE_TIMEOUT_MS;

  const manager = new SessionManager(idleTimeout);

  const server = new McpServer(
    {
      name: "can-see",
      version: "0.5.0",
    },
    {
      instructions: [
        "can-see lets you see and interact with terminal/CLI apps by launching them in virtual terminals and taking PNG screenshots.",
        "",
        "Workflow:",
        "1. launch — start the app",
        "2. wait_for_text / wait_for_idle / wait_for_color — wait for the app to be ready",
        "3. screenshot, screenshot_region, or read_text — see what's on screen",
        "4. get_cell_info — check specific colors/attributes if needed",
        "5. send_keys / send_text — interact with the app",
        "6. wait_for_text / wait_for_idle / wait_for_color — wait for the result",
        "7. diff_screenshot — see what changed (if baseline was captured)",
        "8. close — ALWAYS close sessions when you're done. Do not leave sessions running.",
        "",
        "Use start_recording/stop_recording to capture an animated GIF of a workflow.",
        "Use read_scrollback to see output that scrolled above the visible area.",
        "Use capture_baseline before interactions, then diff_screenshot to see what changed.",
        "",
        "IMPORTANT: Every launch MUST have a matching close.",
        "Sessions auto-close after 5 minutes of inactivity as a safety net, but do not rely on this — close explicitly.",
      ].join("\n"),
    }
  );

  server.tool(
    "launch",
    "Launch a CLI app in a virtual terminal. IMPORTANT: You MUST call 'close' when done with this session.",
    {
      command: z.string().describe("Command to run (e.g., 'node', 'npx')"),
      args: z.array(z.string()).optional().describe("Command arguments"),
      cwd: z.string().optional().describe("Working directory"),
      cols: z.number().optional().describe(`Terminal columns (default: ${cols})`),
      rows: z.number().optional().describe(`Terminal rows (default: ${rows})`),
      env: z.record(z.string(), z.string()).optional().describe("Environment variables to set (merged with server's environment)"),
    },
    async (params) => {
      try {
        const sessionId = manager.launch(params.command, params.args ?? [], {
          cols: params.cols ?? cols,
          rows: params.rows ?? rows,
          cwd: params.cwd,
          env: params.env,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ sessionId }) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "screenshot",
    "Capture the terminal as a PNG image",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const png = session.screenshot();
        const info = session.getInfo();

        const content: Array<{ type: "image"; data: string; mimeType: string } | { type: "text"; text: string }> = [
          {
            type: "image" as const,
            data: png.toString("base64"),
            mimeType: "image/png",
          },
        ];

        if (info.status === "exited") {
          content.push({
            type: "text" as const,
            text: `Process exited with code ${info.exitCode}${info.signal ? ` (signal: ${info.signal})` : ""}`,
          });
        }

        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "screenshot_region",
    "Capture a specific rectangular area of the visible terminal as a PNG image",
    {
      sessionId: z.string().describe("Session ID from launch"),
      startRow: z.number().describe("Top row, 0-based (default: 0)"),
      startCol: z.number().describe("Left column, 0-based (default: 0)"),
      endRow: z.number().describe("Bottom row, exclusive (default: terminal rows)"),
      endCol: z.number().describe("Right column, exclusive (default: terminal cols)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const png = session.screenshotRegion(params.startRow, params.startCol, params.endRow, params.endCol);
        return {
          content: [{
            type: "image" as const,
            data: png.toString("base64"),
            mimeType: "image/png",
          }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "screenshot_text_region",
    "Find text in the viewport and capture the surrounding area as a PNG. Searches visible viewport only (single-line match, returns first match top-to-bottom).",
    {
      sessionId: z.string().describe("Session ID from launch"),
      containingText: z.string().describe("Text to find in the viewport"),
      paddingRows: z.number().optional().describe("Rows of context above and below the matched row (default: 2)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const match = session.findTextInViewport(params.containingText);
        if (!match) {
          return {
            content: [{ type: "text" as const, text: `Text "${params.containingText}" not found in viewport` }],
            isError: true,
          };
        }

        const padding = params.paddingRows ?? 2;
        const info = session.getInfo();
        const startRow = Math.max(0, match.row - padding);
        const endRow = Math.min(info.rows, match.row + padding + 1);
        const png = session.screenshotRegion(startRow, 0, endRow, info.cols);

        return {
          content: [
            { type: "text" as const, text: `Found at row ${match.row}, col ${match.col} — capturing rows ${startRow}-${endRow - 1}` },
            { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
          ],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "capture_baseline",
    "Snapshot current terminal state for later diff comparison (screenshot also auto-captures a baseline)",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const info = session.captureBaseline();
        return { content: [{ type: "text" as const, text: `Baseline captured (${info.cols}x${info.rows}, ${info.cells} cells)` }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "diff_screenshot",
    "Compare current terminal state against the baseline, return PNG with changed cells highlighted in red",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const result = session.diffBaseline();
        const content: Array<{ type: "image"; data: string; mimeType: string } | { type: "text"; text: string }> = [
          {
            type: "image" as const,
            data: result.png.toString("base64"),
            mimeType: "image/png",
          },
          {
            type: "text" as const,
            text: result.summary,
          },
        ];
        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "get_cell_info",
    "Query character, colors, and text attributes at a specific cell or range of cells",
    {
      sessionId: z.string().describe("Session ID from launch"),
      row: z.number().describe("Row, 0-based, viewport-relative"),
      col: z.number().describe("Column, 0-based"),
      endCol: z.number().optional().describe("End column (exclusive) for range query"),
      compact: z.boolean().optional().describe("When true, return only {char, fg, bold} per cell — reduces noise for color-checking workflows"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const info = session.getCellInfo(params.row, params.col, params.endCol, params.compact);
        return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "read_scrollback",
    "Read text that has scrolled above the visible terminal viewport",
    {
      sessionId: z.string().describe("Session ID from launch"),
      lines: z.number().optional().describe("Number of lines from bottom of scrollback (default: 100)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const text = session.getScrollbackText(params.lines);
        if (text === "") {
          return { content: [{ type: "text" as const, text: "No scrollback content available" }] };
        }
        return { content: [{ type: "text" as const, text }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "start_recording",
    "Begin capturing terminal frames for an animated GIF (frames captured on output, not fixed interval)",
    {
      sessionId: z.string().describe("Session ID from launch"),
      minIntervalMs: z.number().optional().describe("Minimum ms between frames (default: 100)"),
      maxDurationMs: z.number().optional().describe("Auto-stop after this many ms (default: 60000)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const minInterval = params.minIntervalMs ?? 100;
        const maxDuration = params.maxDurationMs ?? 60_000;
        session.startRecording(minInterval, maxDuration);
        return { content: [{ type: "text" as const, text: `Recording started (output-triggered, min interval ${minInterval}ms, max ${maxDuration / 1000}s)` }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "stop_recording",
    "Stop recording and return the captured frames as an animated GIF. If the GIF exceeds the inline size limit (~4MB), frames are automatically trimmed. If still too large, the GIF is saved to a temp file and the path is returned. Use outputPath to always save to a specific file.",
    {
      sessionId: z.string().describe("Session ID from launch"),
      outputPath: z.string().optional().describe("File path to save the GIF to. If omitted, returns inline (with automatic fallback to temp file if GIF exceeds size limit)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const result = session.stopRecording(params.outputPath);

        if (result.type === "inline") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ frameCount: result.frameCount, durationMs: result.durationMs }),
              },
              {
                type: "image" as const,
                data: result.gif.toString("base64"),
                mimeType: "image/gif",
              },
            ],
          };
        } else {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                savedTo: result.path,
                frameCount: result.frameCount,
                sizeBytes: result.sizeBytes,
                durationMs: result.durationMs,
                note: "GIF exceeded inline size limit. Use the file system to read this file.",
              }),
            }],
          };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "read_text",
    "Read the terminal buffer as plain text (for programmatic assertions instead of visual screenshots)",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const text = session.getBufferText();
        const info = session.getInfo();

        const content: Array<{ type: "text"; text: string }> = [
          { type: "text" as const, text },
        ];

        if (info.status === "exited") {
          content.push({
            type: "text" as const,
            text: `Process exited with code ${info.exitCode}${info.signal ? ` (signal: ${info.signal})` : ""}`,
          });
        }

        return { content };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "wait_for_text",
    "Wait until specific text appears in the terminal buffer (replaces sleep-and-screenshot polling)",
    {
      sessionId: z.string().describe("Session ID from launch"),
      text: z.string().describe("Text to wait for (substring match)"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const timeout = params.timeoutMs ?? 30_000;
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const bufferText = session.getBufferText();
          if (bufferText.includes(params.text)) {
            return { content: [{ type: "text" as const, text: `Found "${params.text}" after ${Date.now() - start}ms` }] };
          }
          if (session.getInfo().status === "exited") {
            // Final check: text may have arrived with the last output before exit
            if (session.getBufferText().includes(params.text)) {
              return { content: [{ type: "text" as const, text: `Found "${params.text}" after ${Date.now() - start}ms (process exited)` }] };
            }
            return {
              content: [{ type: "text" as const, text: `Process exited before "${params.text}" appeared` }],
              isError: true,
            };
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        return {
          content: [{ type: "text" as const, text: `Timed out after ${timeout}ms waiting for "${params.text}"` }],
          isError: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "wait_for_idle",
    "Wait until terminal output has been stable for a given duration. Use idleMs (default) for apps that stop producing output, or stableMs for apps with constant output like timers/spinners — stableMs compares buffer content instead of tracking raw PTY data.",
    {
      sessionId: z.string().describe("Session ID from launch"),
      idleMs: z.number().optional().describe("Required idle duration in ms (default: 500). Tracks time since last PTY output."),
      stableMs: z.number().optional().describe("Content-stable duration in ms. When set, compares buffer snapshots instead of tracking raw PTY output — use this for apps with timers/spinners."),
      excludeRows: z.array(z.number().int()).optional().describe("Row numbers (0-based) to ignore during content-stable comparison (only applies with stableMs)"),
      excludePattern: z.string().optional().describe("Regex pattern — rows containing matching text are excluded from stability comparison (only applies with stableMs). More robust than excludeRows for dynamic content like timers."),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const timeout = params.timeoutMs ?? 30_000;
        const start = Date.now();

        if (params.stableMs !== undefined && params.idleMs !== undefined) {
          return {
            content: [{ type: "text" as const, text: "Cannot use both stableMs and idleMs — they are mutually exclusive modes" }],
            isError: true,
          };
        }

        if (params.stableMs !== undefined) {
          // Content-stable mode: compare buffer snapshots
          const stableMs = params.stableMs;
          const baseExcludeRows = params.excludeRows ? new Set(params.excludeRows) : new Set<number>();

          let excludeRegex: RegExp | undefined;
          if (params.excludePattern) {
            try {
              excludeRegex = new RegExp(params.excludePattern);
            } catch (e) {
              return {
                content: [{ type: "text" as const, text: `Invalid excludePattern regex: ${(e as Error).message}` }],
                isError: true,
              };
            }
          }

          let previousSnapshot = session.captureCurrentBuffer();
          let stableStartTime: number | null = null;

          while (Date.now() - start < timeout) {
            await new Promise((r) => setTimeout(r, 100));

            const currentSnapshot = session.captureCurrentBuffer();

            // Build dynamic exclude set: merge explicit rows with pattern-matched rows
            let excludeRowSet: Set<number> | undefined = baseExcludeRows.size > 0 ? new Set(baseExcludeRows) : undefined;
            if (excludeRegex) {
              excludeRowSet = excludeRowSet ?? new Set<number>();
              for (let row = 0; row < currentSnapshot.length; row++) {
                const rowText = currentSnapshot[row].map(c => c.char).join("");
                if (excludeRegex.test(rowText)) {
                  excludeRowSet.add(row);
                }
              }
            }

            const diff = diffBuffers(previousSnapshot, currentSnapshot, excludeRowSet);

            if (diff.changedCells === 0) {
              if (stableStartTime === null) stableStartTime = Date.now();
              const stableElapsed = Date.now() - stableStartTime;
              if (stableElapsed >= stableMs) {
                return { content: [{ type: "text" as const, text: `Terminal content stable for ${stableElapsed}ms (waited ${Date.now() - start}ms total)` }] };
              }
            } else {
              previousSnapshot = currentSnapshot;
              stableStartTime = null;
            }

            if (session.getInfo().status === "exited") {
              const finalSnapshot = session.captureCurrentBuffer();
              const finalDiff = diffBuffers(previousSnapshot, finalSnapshot, excludeRowSet);
              if (finalDiff.changedCells === 0 && stableStartTime !== null) {
                const finalElapsed = Date.now() - stableStartTime;
                if (finalElapsed >= stableMs) {
                  return { content: [{ type: "text" as const, text: `Terminal content stable for ${finalElapsed}ms (process exited)` }] };
                }
              }
              return { content: [{ type: "text" as const, text: `Process exited before content was stable for ${stableMs}ms` }] };
            }
          }

          return {
            content: [{ type: "text" as const, text: `Timed out after ${timeout}ms waiting for ${stableMs}ms of content stability` }],
            isError: true,
          };
        }

        // Default idleMs mode: track time since last PTY output
        const idleMs = params.idleMs ?? 500;

        while (Date.now() - start < timeout) {
          const elapsed = Date.now() - session.getLastOutput();
          if (elapsed >= idleMs) {
            return { content: [{ type: "text" as const, text: `Terminal idle for ${elapsed}ms (waited ${Date.now() - start}ms total)` }] };
          }
          if (session.getInfo().status === "exited") {
            const finalElapsed = Date.now() - session.getLastOutput();
            if (finalElapsed >= idleMs) {
              return { content: [{ type: "text" as const, text: `Terminal idle for ${finalElapsed}ms (process exited)` }] };
            }
            return { content: [{ type: "text" as const, text: `Process exited (idle ${finalElapsed}ms, needed ${idleMs}ms)` }] };
          }
          const remaining = idleMs - elapsed;
          await new Promise((r) => setTimeout(r, Math.min(remaining, 100)));
        }

        return {
          content: [{ type: "text" as const, text: `Timed out after ${timeout}ms waiting for ${idleMs}ms of idle` }],
          isError: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "wait_for_color",
    "Wait until a specific color appears at a position (or anywhere in the viewport)",
    {
      sessionId: z.string().describe("Session ID from launch"),
      color: z.string().describe("Color to wait for: hex (#ff0000) or ANSI name (red, bright-green)"),
      row: z.number().optional().describe("Specific row to check (viewport-relative)"),
      col: z.number().optional().describe("Specific column to check"),
      target: z.enum(["fg", "bg"]).optional().describe("Check foreground or background color (default: fg)"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const targetHex = parseColor(params.color);
        const colorTarget = params.target ?? "fg";
        const timeout = params.timeoutMs ?? 30_000;
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const found = session.findColor(targetHex, colorTarget, params.row, params.col);
          if (found) {
            return { content: [{ type: "text" as const, text: `Found ${params.color} (${targetHex}) at row ${found.row}, col ${found.col} after ${Date.now() - start}ms` }] };
          }
          if (session.getInfo().status === "exited") {
            // Final check: color may have appeared in the last output before exit
            const finalCheck = session.findColor(targetHex, colorTarget, params.row, params.col);
            if (finalCheck) {
              return { content: [{ type: "text" as const, text: `Found ${params.color} (${targetHex}) at row ${finalCheck.row}, col ${finalCheck.col} after ${Date.now() - start}ms (process exited)` }] };
            }
            return {
              content: [{ type: "text" as const, text: `Process exited before color "${params.color}" appeared` }],
              isError: true,
            };
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        return {
          content: [{ type: "text" as const, text: `Timed out after ${timeout}ms waiting for color "${params.color}"` }],
          isError: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "wait_for_exit",
    "Wait until the process exits and return its exit code and signal",
    {
      sessionId: z.string().describe("Session ID from launch"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const info = session.getInfo();
        if (info.status === "exited") {
          return { content: [{ type: "text" as const, text: JSON.stringify({ exitCode: info.exitCode ?? null, signal: info.signal ?? null }) }] };
        }

        const timeout = params.timeoutMs ?? 30_000;
        const start = Date.now();

        while (Date.now() - start < timeout) {
          await new Promise((r) => setTimeout(r, 100));
          const current = session.getInfo();
          if (current.status === "exited") {
            return { content: [{ type: "text" as const, text: JSON.stringify({ exitCode: current.exitCode ?? null, signal: current.signal ?? null }) }] };
          }
        }

        return {
          content: [{ type: "text" as const, text: `Timed out after ${timeout}ms waiting for process to exit` }],
          isError: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "send_keys",
    "Send keystrokes to the app (e.g., 'Enter', 'Ctrl+C', ['Down', 'Down', 'Enter'])",
    {
      sessionId: z.string().describe("Session ID from launch"),
      keys: z.union([z.string(), z.array(z.string())]).describe("Key(s) to send"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const resolved = resolveKeys(params.keys);
        session.write(resolved);
        return { content: [{ type: "text" as const, text: "Keys sent" }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "send_text",
    "Type a string of text into the app",
    {
      sessionId: z.string().describe("Session ID from launch"),
      text: z.string().describe("Text to type"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        session.write(params.text);
        return { content: [{ type: "text" as const, text: "Text sent" }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "get_process_status",
    "Get the current process status — use to distinguish 'app is idle' from 'app has exited'",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const info = session.getInfo();
        const result: { running: boolean; pid: number; exitCode?: number; signal?: string } = {
          running: info.status === "running",
          pid: session.getPid(),
        };
        if (info.exitCode !== undefined) result.exitCode = info.exitCode;
        if (info.signal !== undefined) result.signal = info.signal;
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "list_sessions",
    "List all active terminal sessions",
    {},
    async () => {
      const sessions = manager.list();
      return { content: [{ type: "text" as const, text: JSON.stringify(sessions) }] };
    }
  );

  server.tool(
    "close",
    "Kill the app and clean up the session",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        manager.close(params.sessionId);
        return { content: [{ type: "text" as const, text: "Session closed" }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    }
  );

  server.tool(
    "close_all",
    "Kill all active sessions at once. Useful for cleanup between test runs or when sessions may have been orphaned.",
    {},
    async () => {
      const closed = manager.closeAllSessions();
      return { content: [{ type: "text" as const, text: JSON.stringify({ closed }) }] };
    }
  );

  return server;
}

// Entry point: run as stdio server when executed directly
const isMainModule = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMainModule) {
  const server = createServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
