import { describe, it, expect } from "vitest";
import { paletteColor, rgbColor, toHex, resolveColor, parseColor, DEFAULT_FG, DEFAULT_BG, ANSI_NAMES } from "../src/colors.js";

describe("colors", () => {
  it("paletteColor returns ANSI colors for indices 0-15", () => {
    expect(paletteColor(0)).toBe("#000000");
    expect(paletteColor(1)).toBe("#cd0000");
    expect(paletteColor(15)).toBe("#ffffff");
  });

  it("paletteColor returns 216-color cube values", () => {
    const color = paletteColor(196); // bright red in 216 cube
    expect(color).toMatch(/^rgb\(/);
  });

  it("paletteColor returns grayscale values", () => {
    const color = paletteColor(232); // darkest gray
    expect(color).toBe("rgb(8, 8, 8)");
  });

  it("rgbColor converts packed RGB to css string", () => {
    expect(rgbColor(0xff0000)).toBe("rgb(255, 0, 0)");
    expect(rgbColor(0x00ff00)).toBe("rgb(0, 255, 0)");
  });

  it("toHex normalizes hex strings", () => {
    expect(toHex("#FF0000")).toBe("#ff0000");
    expect(toHex("#ff0000")).toBe("#ff0000");
  });

  it("toHex converts rgb() to hex", () => {
    expect(toHex("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(toHex("rgb(0, 205, 0)")).toBe("#00cd00");
  });

  it("parseColor resolves ANSI names", () => {
    expect(parseColor("red")).toBe("#cd0000");
    expect(parseColor("bright-green")).toBe("#00ff00");
  });

  it("parseColor passes through hex", () => {
    expect(parseColor("#abcdef")).toBe("#abcdef");
  });

  it("parseColor throws on unknown color", () => {
    expect(() => parseColor("fuchsia")).toThrow("Unknown color");
  });
});
