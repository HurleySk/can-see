// src/recorder.ts
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
import { createCanvas, Image } from "canvas";
import { renderTerminal, CELL_WIDTH, CELL_HEIGHT, PADDING } from "./renderer.js";
// gifenc is CJS with a `default` export key — ESM interop varies between
// Node (default import = module.exports) and vitest (default import = module.exports.default).
// Use createRequire for consistent behavior.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require("gifenc") as {
  GIFEncoder: () => { writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: number[][]; delay?: number }): void; finish(): void; bytes(): Uint8Array };
  quantize: (rgba: Uint8Array, maxColors: number) => number[][];
  applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
};

const MAX_FRAMES = 300;
export const INLINE_SIZE_THRESHOLD = 4_000_000; // ~5.3MB after base64 encoding
export const MAX_FRAME_HALVING_ATTEMPTS = 2;

export interface Frame {
  pixels: Uint8Array;
  delay: number; // ms
  width: number;
  height: number;
}

export class Recorder {
  private frames: Frame[] = [];
  private lastFrameTime = 0;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private maxTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private terminal: Terminal,
    private minIntervalMs: number = 100,
    private maxDurationMs: number = 60_000,
    private onAutoStop?: () => void,
  ) {
    // Auto-stop after max duration
    this.maxTimer = setTimeout(() => {
      if (!this.stopped) {
        this.stopped = true;
        this.onAutoStop?.();
      }
    }, this.maxDurationMs);
  }

  /**
   * Called when PTY output arrives. Captures a frame if enough time has passed,
   * or schedules one after the debounce interval.
   */
  onOutput(): void {
    if (this.stopped) return;
    if (this.frames.length >= MAX_FRAMES) {
      this.stopped = true;
      this.onAutoStop?.();
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= this.minIntervalMs) {
      this.captureFrame();
    } else {
      // Schedule capture after remaining debounce time
      if (!this.debounceTimer) {
        const remaining = this.minIntervalMs - elapsed;
        this.debounceTimer = setTimeout(() => {
          this.debounceTimer = undefined;
          if (!this.stopped && this.frames.length < MAX_FRAMES) {
            this.captureFrame();
          }
        }, remaining);
      }
    }
  }

  private captureFrame(): void {
    const now = Date.now();
    const delay = this.lastFrameTime === 0 ? 100 : now - this.lastFrameTime;
    this.lastFrameTime = now;

    const cols = this.terminal.cols;
    const rows = this.terminal.rows;
    const width = cols * CELL_WIDTH + PADDING * 2;
    const height = rows * CELL_HEIGHT + PADDING * 2;

    // Render to canvas and extract raw pixel data
    const png = renderTerminal(this.terminal);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = png;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    this.frames.push({
      pixels: new Uint8Array(imageData.data),
      delay: Math.max(20, Math.round(delay / 10) * 10), // GIF uses 10ms units, min 20ms
      width,
      height,
    });
  }

  /**
   * Finalize recording and return captured frames.
   */
  stop(): Frame[] {
    this.stopped = true;
    this.dispose();

    if (this.frames.length === 0) {
      this.captureFrame();
    }

    return [...this.frames];
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = undefined;
    }
  }
}

/**
 * Encode an array of frames as an animated GIF.
 */
export function encodeGif(frames: Frame[]): Buffer {
  if (frames.length === 0) {
    throw new Error("Cannot encode GIF with zero frames");
  }
  const width = frames[0].width;
  const height = frames[0].height;
  const gif = GIFEncoder();

  for (const frame of frames) {
    if (frame.width !== width || frame.height !== height) {
      throw new Error(`Frame size mismatch: expected ${width}x${height}, got ${frame.width}x${frame.height}`);
    }
    const palette = quantize(frame.pixels, 256);
    const indexed = applyPalette(frame.pixels, palette);
    gif.writeFrame(indexed, width, height, { palette, delay: frame.delay });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

/**
 * Drop every other frame, doubling delays to preserve timing.
 */
export function halveFrames(frames: Frame[]): Frame[] {
  return frames
    .filter((_, i) => i % 2 === 0)
    .map((f) => ({ ...f, delay: Math.min(f.delay * 2, 1000) }));
}
