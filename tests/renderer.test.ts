import { describe, it, expect, beforeEach } from "vitest";
import { Terminal } from "@xterm/headless";
import { renderTerminal } from "../src/renderer.js";

function writeSync(terminal: Terminal, data: string): Promise<void> {
  return new Promise<void>((resolve) => {
    terminal.write(data, resolve);
  });
}

describe("renderTerminal", () => {
  let terminal: Terminal;

  beforeEach(() => {
    terminal = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
  });

  it("returns a valid PNG buffer", async () => {
    await writeSync(terminal, "Hello, world!");
    const png = renderTerminal(terminal);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  it("produces an image with correct dimensions", () => {
    const png = renderTerminal(terminal);
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(50);
  });

  it("produces different images for different content", async () => {
    await writeSync(terminal, "AAA");
    const png1 = renderTerminal(terminal);

    const terminal2 = new Terminal({ cols: 40, rows: 10, allowProposedApi: true });
    await writeSync(terminal2, "ZZZ");
    const png2 = renderTerminal(terminal2);

    expect(Buffer.compare(png1, png2)).not.toBe(0);
  });

  it("handles empty terminal", () => {
    const png = renderTerminal(terminal);
    expect(png.length).toBeGreaterThan(0);
    expect(png[0]).toBe(0x89);
  });

  it("handles terminal with ANSI colors", async () => {
    await writeSync(terminal, "\x1b[31mRed text\x1b[0m Normal text");
    const png = renderTerminal(terminal);
    expect(png[0]).toBe(0x89);
    expect(png.length).toBeGreaterThan(0);
  });
});
