import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
import * as pty from "node-pty";
import { v4 as uuidv4 } from "uuid";
import { execFileSync } from "child_process";
import path from "path";
import { renderTerminal } from "./renderer.js";
import type { SessionInfo } from "./types.js";

export interface SessionOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
}

/**
 * On Windows, node-pty's conpty backend requires a fully-resolved executable
 * path (with extension). This helper resolves bare command names like "node"
 * to their full path (e.g. "C:\Program Files\nodejs\node.exe").
 */
function resolveCommand(command: string): string {
  if (process.platform !== "win32") return command;
  // If it already has an extension or is an absolute path with extension, use as-is
  if (path.extname(command)) return command;
  try {
    const resolved = execFileSync("where", [command], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
    if (resolved) return resolved;
  } catch {
    // Fall through
  }
  return command;
}

export class Session {
  readonly sessionId: string;
  readonly command: string;
  readonly args: string[];
  readonly cols: number;
  readonly rows: number;
  readonly createdAt: string;

  private terminal: Terminal;
  private ptyProcess: pty.IPty;
  private status: "running" | "exited" = "running";
  private exitCode?: number;
  private signal?: string;
  private lastActivity: number;
  private lastOutput: number;

  constructor(command: string, args: string[], options: SessionOptions = {}) {
    this.sessionId = uuidv4();
    this.command = command;
    this.args = args;
    this.cols = options.cols ?? 120;
    this.rows = options.rows ?? 30;
    this.createdAt = new Date().toISOString();
    this.lastActivity = Date.now();
    this.lastOutput = Date.now();

    this.terminal = new Terminal({
      cols: this.cols,
      rows: this.rows,
      allowProposedApi: true,
    });

    const resolvedCommand = resolveCommand(command);
    this.ptyProcess = pty.spawn(resolvedCommand, args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: options.cwd ?? process.cwd(),
      env: process.env as Record<string, string>,
    });

    this.ptyProcess.onData((data: string) => {
      this.lastOutput = Date.now();
      this.terminal.write(data);
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.status = "exited";
      this.exitCode = exitCode;
      this.signal = signal !== undefined ? String(signal) : undefined;
    });
  }

  write(data: string): void {
    if (this.status !== "running") {
      throw new Error("Session has exited");
    }
    this.lastActivity = Date.now();
    this.ptyProcess.write(data);
  }

  screenshot(): Buffer {
    this.lastActivity = Date.now();
    return renderTerminal(this.terminal);
  }

  getBufferText(): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    return lines.join("\n");
  }

  getInfo(): SessionInfo {
    return {
      sessionId: this.sessionId,
      command: this.command,
      args: this.args,
      status: this.status,
      exitCode: this.exitCode,
      signal: this.signal,
      cols: this.cols,
      rows: this.rows,
      createdAt: this.createdAt,
    };
  }

  getLastActivity(): number {
    return this.lastActivity;
  }

  getLastOutput(): number {
    return this.lastOutput;
  }

  close(): void {
    if (this.status === "running") {
      try {
        this.ptyProcess.kill();
      } catch {
        // Already dead
      }
    }
    this.terminal.dispose();
  }
}
