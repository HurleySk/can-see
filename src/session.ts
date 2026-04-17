import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
import * as pty from "node-pty";
import { v4 as uuidv4 } from "uuid";
import { execFileSync } from "child_process";
import path from "path";
import { renderTerminal, type RenderOptions } from "./renderer.js";
import { resolveColor } from "./colors.js";
import { captureBuffer, diffBuffers, type CellSnapshot } from "./diff.js";
import { Recorder, encodeGif, halveFrames, INLINE_SIZE_THRESHOLD, MAX_FRAME_HALVING_ATTEMPTS } from "./recorder.js";
import fs from "fs";
import os from "os";
import type { SessionInfo } from "./types.js";

export interface SessionOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
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
  private baseline?: CellSnapshot[][];
  private recorder?: Recorder;

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
      env: { ...process.env, ...options.env } as Record<string, string>,
    });

    this.ptyProcess.onData((data: string) => {
      this.lastOutput = Date.now();
      this.terminal.write(data);
      this.recorder?.onOutput();
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
    this.baseline = captureBuffer(this.terminal);
    return renderTerminal(this.terminal);
  }

  screenshotRegion(startRow: number, startCol: number, endRow: number, endCol: number): Buffer {
    this.lastActivity = Date.now();
    if (startRow < 0 || startCol < 0 || endRow > this.rows || endCol > this.cols || startRow >= endRow || startCol >= endCol) {
      throw new Error(`Invalid region: rows ${startRow}-${endRow}, cols ${startCol}-${endCol} (terminal is ${this.rows}x${this.cols})`);
    }
    return renderTerminal(this.terminal, { startRow, startCol, endRow, endCol });
  }

  captureCurrentBuffer(): CellSnapshot[][] {
    return captureBuffer(this.terminal);
  }

  captureBaseline(): { rows: number; cols: number; cells: number } {
    this.lastActivity = Date.now();
    this.baseline = captureBuffer(this.terminal);
    return { rows: this.rows, cols: this.cols, cells: this.rows * this.cols };
  }

  diffBaseline(): { png: Buffer; changedCells: number; summary: string } {
    this.lastActivity = Date.now();
    if (!this.baseline) {
      throw new Error("No baseline captured. Call capture_baseline or screenshot first.");
    }
    const current = captureBuffer(this.terminal);
    const diff = diffBuffers(this.baseline, current);

    const png = renderTerminal(this.terminal, { highlights: diff.highlights });
    const summary = diff.changedCells > 0
      ? `${diff.changedCells} cells changed in rows ${diff.changedRowRange![0]}-${diff.changedRowRange![1]}`
      : "No changes detected";

    return { png, changedCells: diff.changedCells, summary };
  }

  getCellInfo(row: number, col: number, endCol?: number, compact?: boolean): object {
    this.lastActivity = Date.now();
    const buffer = this.terminal.buffer.active;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      throw new Error(`Position out of bounds: row ${row}, col ${col} (terminal is ${this.rows}x${this.cols})`);
    }
    const line = buffer.getLine(row);
    if (!line) throw new Error(`No data at row ${row}`);

    if (endCol === undefined) {
      // Single cell
      const cell = line.getCell(col);
      if (!cell) throw new Error(`No data at row ${row}, col ${col}`);
      if (compact) {
        return {
          char: cell.getChars() || " ",
          fg: resolveColor(cell, "fg"),
          bold: !!cell.isBold(),
        };
      }
      return {
        char: cell.getChars() || " ",
        fg: resolveColor(cell, "fg"),
        bg: resolveColor(cell, "bg"),
        bold: !!cell.isBold(),
        italic: !!cell.isItalic(),
        underline: !!cell.isUnderline(),
        inverse: !!cell.isInverse(),
        dim: !!cell.isDim(),
        strikethrough: !!cell.isStrikethrough(),
      };
    }

    // Range
    const ec = Math.min(endCol, this.cols);
    const cells: object[] = [];
    let text = "";
    for (let c = col; c < ec; c++) {
      const cell = line.getCell(c);
      const ch = cell?.getChars() || " ";
      text += ch;
      if (compact) {
        cells.push({
          char: ch,
          fg: cell ? resolveColor(cell, "fg") : "#cccccc",
          bold: !!cell?.isBold(),
        });
      } else {
        cells.push({
          char: ch,
          fg: cell ? resolveColor(cell, "fg") : "#cccccc",
          bg: cell ? resolveColor(cell, "bg") : "#1e1e1e",
          bold: !!cell?.isBold(),
          italic: !!cell?.isItalic(),
          underline: !!cell?.isUnderline(),
          inverse: !!cell?.isInverse(),
          dim: !!cell?.isDim(),
          strikethrough: !!cell?.isStrikethrough(),
        });
      }
    }
    return { text, cells };
  }

  getScrollbackText(lines: number = 100): string {
    this.lastActivity = Date.now();
    const buffer = this.terminal.buffer.active;
    const scrollbackEnd = buffer.baseY;
    if (scrollbackEnd === 0) return "";

    const start = Math.max(0, scrollbackEnd - lines);
    const result: string[] = [];
    for (let i = start; i < scrollbackEnd; i++) {
      const line = buffer.getLine(i);
      if (line) result.push(line.translateToString(true));
    }
    return result.join("\n");
  }

  startRecording(minIntervalMs: number = 100, maxDurationMs: number = 60_000): void {
    if (this.recorder) throw new Error("Recording already in progress");
    this.recorder = new Recorder(this.terminal, minIntervalMs, maxDurationMs, () => {
      // auto-stop callback — just mark it; stop_recording will finalize
    });
  }

  stopRecording(outputPath?: string): { type: "inline"; gif: Buffer; frameCount: number; durationMs: number } | { type: "file"; path: string; frameCount: number; sizeBytes: number; durationMs: number } {
    if (!this.recorder) throw new Error("No recording in progress");
    let frames = this.recorder.stop();
    this.recorder = undefined;

    if (outputPath) {
      const gif = encodeGif(frames);
      const durationMs = frames.reduce((sum, f) => sum + f.delay, 0);
      fs.writeFileSync(outputPath, gif);
      return { type: "file", path: outputPath, frameCount: frames.length, sizeBytes: gif.length, durationMs };
    }

    let gif = encodeGif(frames);
    if (gif.length <= INLINE_SIZE_THRESHOLD) {
      const durationMs = frames.reduce((sum, f) => sum + f.delay, 0);
      return { type: "inline", gif, frameCount: frames.length, durationMs };
    }

    for (let i = 0; i < MAX_FRAME_HALVING_ATTEMPTS; i++) {
      frames = halveFrames(frames);
      gif = encodeGif(frames);
      if (gif.length <= INLINE_SIZE_THRESHOLD) {
        const durationMs = frames.reduce((sum, f) => sum + f.delay, 0);
        return { type: "inline", gif, frameCount: frames.length, durationMs };
      }
    }

    const tmpPath = path.join(os.tmpdir(), `can-see-${Date.now()}.gif`);
    fs.writeFileSync(tmpPath, gif);
    const durationMs = frames.reduce((sum, f) => sum + f.delay, 0);
    return { type: "file", path: tmpPath, frameCount: frames.length, sizeBytes: gif.length, durationMs };
  }

  findColor(targetHex: string, target: "fg" | "bg", row?: number, col?: number): { row: number; col: number } | null {
    this.lastActivity = Date.now();
    const buffer = this.terminal.buffer.active;

    if (row !== undefined && col !== undefined) {
      // Check single cell
      const line = buffer.getLine(row);
      const cell = line?.getCell(col);
      if (cell && resolveColor(cell, target) === targetHex) {
        return { row, col };
      }
      return null;
    }

    const startRow = row ?? 0;
    const endRow = row !== undefined ? row + 1 : this.rows;

    for (let r = startRow; r < endRow; r++) {
      const line = buffer.getLine(r);
      if (!line) continue;
      for (let c = 0; c < this.cols; c++) {
        const cell = line.getCell(c);
        if (cell && resolveColor(cell, target) === targetHex) {
          return { row: r, col: c };
        }
      }
    }
    return null;
  }

  findTextInViewport(text: string): { row: number; col: number } | null {
    this.lastActivity = Date.now();
    const buffer = this.terminal.buffer.active;
    for (let row = 0; row < this.rows; row++) {
      const line = buffer.getLine(row);
      if (line) {
        const lineText = line.translateToString(true);
        const col = lineText.indexOf(text);
        if (col !== -1) return { row, col };
      }
    }
    return null;
  }

  getBufferText(): string {
    this.lastActivity = Date.now();
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

  getPid(): number {
    return this.ptyProcess.pid;
  }

  getLastActivity(): number {
    return this.lastActivity;
  }

  getLastOutput(): number {
    return this.lastOutput;
  }

  close(): void {
    if (this.recorder) {
      this.recorder.dispose();
      this.recorder = undefined;
    }
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
