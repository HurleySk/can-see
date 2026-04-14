// src/recorder.ts
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
import { createCanvas, Image } from "canvas";
import { renderTerminal, CELL_WIDTH, CELL_HEIGHT, PADDING } from "./renderer.js";
import { GIFEncoder, quantize, applyPalette } from "gifenc";

const MAX_FRAMES = 300;

interface Frame {
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
   * Finalize recording and encode all frames as an animated GIF.
   * Returns the GIF as a Buffer.
   */
  stop(): Buffer {
    this.stopped = true;
    this.dispose();

    if (this.frames.length === 0) {
      this.captureFrame();
    }

    const width = this.frames[0].width;
    const height = this.frames[0].height;
    const gif = GIFEncoder();

    for (const frame of this.frames) {
      const palette = quantize(frame.pixels, 256);
      const indexed = applyPalette(frame.pixels, palette);
      gif.writeFrame(indexed, width, height, { palette, delay: frame.delay });
    }

    gif.finish();
    return Buffer.from(gif.bytes());
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
