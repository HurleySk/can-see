#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SessionManager } from "./session-manager.js";
import { resolveKeys } from "./keys.js";
import { DEFAULT_COLS, DEFAULT_ROWS, DEFAULT_IDLE_TIMEOUT_MS } from "./types.js";

export function createServer(): McpServer {
  const cols = parseInt(process.env.DEFAULT_COLS ?? "", 10) || DEFAULT_COLS;
  const rows = parseInt(process.env.DEFAULT_ROWS ?? "", 10) || DEFAULT_ROWS;
  const idleTimeout = parseInt(process.env.IDLE_TIMEOUT_MS ?? "", 10) || DEFAULT_IDLE_TIMEOUT_MS;

  const manager = new SessionManager(idleTimeout);

  const server = new McpServer(
    {
      name: "can-see",
      version: "0.2.0",
    },
    {
      instructions: [
        "can-see lets you see and interact with terminal/CLI apps by launching them in virtual terminals and taking PNG screenshots.",
        "",
        "Workflow:",
        "1. launch — start the app",
        "2. wait_for_text / wait_for_idle — wait for the app to be ready (preferred over arbitrary delays)",
        "3. screenshot or read_text — see what's on screen",
        "4. send_keys / send_text — interact with the app",
        "5. wait_for_text / wait_for_idle — wait for the result",
        "6. screenshot or read_text — see the result",
        "7. close — ALWAYS close sessions when you're done. Do not leave sessions running.",
        "",
        "IMPORTANT: Every launch MUST have a matching close. When you finish debugging, testing, or inspecting an app, close all sessions you opened.",
        "Sessions auto-close after 5 minutes of inactivity as a safety net, but do not rely on this — close explicitly.",
        "",
        "Prefer wait_for_text/wait_for_idle over arbitrary sleeps. Prefer read_text over screenshot when you only need to check text content.",
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
