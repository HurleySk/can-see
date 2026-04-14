import { describe, it, expect } from "vitest";
import { resolveKeys } from "../src/keys.js";

describe("resolveKeys", () => {
  it("passes printable text through unchanged", () => {
    expect(resolveKeys("hello")).toBe("hello");
  });

  it("resolves Enter to carriage return", () => {
    expect(resolveKeys("Enter")).toBe("\r");
  });

  it("resolves Tab", () => {
    expect(resolveKeys("Tab")).toBe("\t");
  });

  it("resolves Escape", () => {
    expect(resolveKeys("Escape")).toBe("\x1b");
  });

  it("resolves Backspace", () => {
    expect(resolveKeys("Backspace")).toBe("\x7f");
  });

  it("resolves Space to a space character", () => {
    expect(resolveKeys("Space")).toBe(" ");
  });

  it("resolves arrow keys to ANSI sequences", () => {
    expect(resolveKeys("Up")).toBe("\x1b[A");
    expect(resolveKeys("Down")).toBe("\x1b[B");
    expect(resolveKeys("Right")).toBe("\x1b[C");
    expect(resolveKeys("Left")).toBe("\x1b[D");
  });

  it("resolves Ctrl combos to control characters", () => {
    expect(resolveKeys("Ctrl+C")).toBe("\x03");
    expect(resolveKeys("Ctrl+D")).toBe("\x04");
    expect(resolveKeys("Ctrl+Z")).toBe("\x1a");
  });

  it("resolves Ctrl+A through Ctrl+Z", () => {
    expect(resolveKeys("Ctrl+A")).toBe("\x01");
    expect(resolveKeys("Ctrl+L")).toBe("\x0c");
  });

  it("resolves an array of keys in order", () => {
    expect(resolveKeys(["Down", "Down", "Enter"])).toBe("\x1b[B\x1b[B\r");
  });

  it("resolves mixed array of text and special keys", () => {
    expect(resolveKeys(["hello", "Enter"])).toBe("hello\r");
  });

  it("throws on unknown Ctrl combo letter", () => {
    expect(() => resolveKeys("Ctrl+1")).toThrow("Unknown key");
  });
});
