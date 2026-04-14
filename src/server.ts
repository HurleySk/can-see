#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SessionManager } from "./session-manager.js";
import { resolveKeys } from "./keys.js";
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_IDLE_TIMEOUT_MS } from "./types.js";
import { parseColor } from "./colors.js";

export function createServer(): McpServer {
  const cols = parseInt(process.env.DEFAULT_COLS ?? "", 10) || DEFAULT_COLS;
  const rows = parseInt(process.env.DEFAULT_ROWS ?? "", 10) || DEFAULT_ROWS;
  const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS ?? "", 10) || DEFAULT_IDLE_TIMEOUT_MS;

  const manager = new SessionManager(idleTimeout);

  const server = new McpServer(
    {
      name: "can-see",
      version: "0.3.0",
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
    },
    async (params) => {
      try {
        const sessionId = manager.launch(params.command, params.args ?? [], {
          cols: params.cols ?? cols,
          rows: params.rows ?? rows,
          cwd: params.cwd,
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
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const info = session.getCellInfo(params.row, params.col, params.endCol);
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
    "Stop recording and return the captured frames as an animated GIF",
    {
      sessionId: z.string().describe("Session ID from launch"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const gif = session.stopRecording();
        return {
          content: [{
            type: "image" as const,
            data: gif.toString("base64"),
            mimeType: "image/gif",
          }],
        };
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
    "Wait until terminal output has been stable for a given duration (use after send_keys when you don't know what text to expect)",
    {
      sessionId: z.string().describe("Session ID from launch"),
      idleMs: z.number().optional().describe("Required idle duration in ms (default: 500)"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 30000)"),
    },
    async (params) => {
      try {
        const session = manager.get(params.sessionId);
        const idleMs = params.idleMs ?? 500;
        const timeout = params.timeoutMs ?? 30_000;
        const start = Date.now();

        while (Date.now() - start < timeout) {
          const elapsed = Date.now() - session.getLastOutput();
          if (elapsed >= idleMs) {
            return { content: [{ type: "text" as const, text: `Terminal idle for ${elapsed}ms (waited ${Date.now() - start}ms total)` }] };
          }
          if (session.getInfo().status === "exited") {
            // Process exited — check one more time if idle threshold is met
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
