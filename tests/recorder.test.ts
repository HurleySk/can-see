import { describe, it, expect } from "vitest";
import { encodeGif, halveFrames, type Frame } from "../src/recorder.js";

function makeFrame(delay: number): Frame {
  // Minimal 2x2 RGBA pixel buffer
  const pixels = new Uint8Array(2 * 2 * 4);
  pixels.fill(128);
  return { pixels, delay, width: 2, height: 2 };
}

describe("halveFrames", () => {
  it("keeps every other frame and doubles delays", () => {
    const frames = [makeFrame(100), makeFrame(100), makeFrame(100), makeFrame(100)];
    const result = halveFrames(frames);
    expect(result).toHaveLength(2);
    expect(result[0].delay).toBe(200);
    expect(result[1].delay).toBe(200);
  });

  it("caps delay at 1000ms", () => {
    const frames = [makeFrame(600), makeFrame(600)];
    const result = halveFrames(frames);
    expect(result).toHaveLength(1);
    expect(result[0].delay).toBe(1000);
  });

  it("keeps the single frame with doubled delay for single-element input", () => {
    const frames = [makeFrame(100)];
    const result = halveFrames(frames);
    expect(result).toHaveLength(1);
    expect(result[0].delay).toBe(200);
  });

  it("returns empty array for empty input", () => {
    expect(halveFrames([])).toHaveLength(0);
  });
});

describe("encodeGif", () => {
  it("produces a valid GIF buffer", () => {
    const frames = [makeFrame(100)];
    const gif = encodeGif(frames);
    // GIF89a magic bytes
    expect(gif[0]).toBe(0x47); // G
    expect(gif[1]).toBe(0x49); // I
    expect(gif[2]).toBe(0x46); // F
    expect(gif[3]).toBe(0x38); // 8
    expect(gif[4]).toBe(0x39); // 9
    expect(gif[5]).toBe(0x61); // a
  });

  it("encodes multiple frames", () => {
    const singleGif = encodeGif([makeFrame(100)]);
    const multiGif = encodeGif([makeFrame(100), makeFrame(100), makeFrame(100)]);
    // Multi-frame GIF should be larger
    expect(multiGif.length).toBeGreaterThan(singleGif.length);
  });
});
