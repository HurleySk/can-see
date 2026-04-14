import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_APP = path.join(__dirname, "fixtures", "echo-app.js");

describe("MCP Server", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
  });

  it("lists all 17 tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("launch");
    expect(names).toContain("screenshot");
    expect(names).toContain("screenshot_region");
    expect(names).toContain("capture_baseline");
    expect(names).toContain("diff_screenshot");
    expect(names).toContain("get_cell_info");
    expect(names).toContain("read_text");
    expect(names).toContain("read_scrollback");
    expect(names).toContain("wait_for_text");
    expect(names).toContain("wait_for_idle");
    expect(names).toContain("wait_for_color");
    expect(names).toContain("start_recording");
    expect(names).toContain("stop_recording");
    expect(names).toContain("send_keys");
    expect(names).toContain("send_text");
    expect(names).toContain("list_sessions");
    expect(names).toContain("close");
    expect(result.tools).toHaveLength(17);
  });

  it("launch returns a sessionId", async () => {
    const result = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.find((c) => c.type === "text");
    const parsed = JSON.parse(text!.text!);
    expect(parsed.sessionId).toBeTruthy();
  });

  it("screenshot returns an image after launch", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const launchContent = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(launchContent.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 1000));

    const result = await client.callTool({
      name: "screenshot",
      arguments: { sessionId },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    const image = content.find((c) => c.type === "image");
    expect(image).toBeTruthy();
    expect(image!.mimeType).toBe("image/png");
    expect(image!.data!.length).toBeGreaterThan(0);
  });

  it("send_keys sends input to the app", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const launchContent = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(launchContent.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 500));

    const result = await client.callTool({
      name: "send_keys",
      arguments: { sessionId, keys: ["h", "i"] },
    });
    expect(result.isError).toBeFalsy();
  });

  it("send_text sends text input", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const launchContent = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(launchContent.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 500));

    const result = await client.callTool({
      name: "send_text",
      arguments: { sessionId, text: "hello" },
    });
    expect(result.isError).toBeFalsy();
  });

  it("list_sessions returns active sessions", async () => {
    await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });

    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const content = result.content as Array<{ type: string; text?: string }>;
    const sessions = JSON.parse(content.find((c) => c.type === "text")!.text!);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("running");
  });

  it("close kills a session", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const launchContent = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(launchContent.find((c) => c.type === "text")!.text!);

    const result = await client.callTool({
      name: "close",
      arguments: { sessionId },
    });
    expect(result.isError).toBeFalsy();

    const listResult = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const listContent = listResult.content as Array<{ type: string; text?: string }>;
    const sessions = JSON.parse(listContent.find((c) => c.type === "text")!.text!);
    expect(sessions).toHaveLength(0);
  });

  it("returns error for invalid sessionId", async () => {
    const result = await client.callTool({
      name: "screenshot",
      arguments: { sessionId: "bogus" },
    });
    expect(result.isError).toBe(true);
  });

  it("read_text returns buffer content", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 1000));

    const readResult = await client.callTool({
      name: "read_text",
      arguments: { sessionId },
    });
    const readContent = readResult.content as Array<{ type: string; text?: string }>;
    const text = readContent.find((c) => c.type === "text")!.text!;
    expect(text).toContain(">");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("wait_for_text resolves when text appears", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    const waitResult = await client.callTool({
      name: "wait_for_text",
      arguments: { sessionId, text: ">", timeoutMs: 5000 },
    });
    const waitContent = waitResult.content as Array<{ type: string; text?: string }>;
    expect(waitContent[0].text).toContain("Found");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("wait_for_text times out when text never appears", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    const waitResult = await client.callTool({
      name: "wait_for_text",
      arguments: { sessionId, text: "NONEXISTENT_TEXT_xyz", timeoutMs: 500 },
    });
    expect(waitResult.isError).toBe(true);

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("wait_for_idle resolves when output settles", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    const idleResult = await client.callTool({
      name: "wait_for_idle",
      arguments: { sessionId, idleMs: 500, timeoutMs: 5000 },
    });
    const idleContent = idleResult.content as Array<{ type: string; text?: string }>;
    expect(idleContent[0].text).toContain("Terminal idle");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("screenshot_region returns a smaller PNG", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 1000));

    const regionResult = await client.callTool({
      name: "screenshot_region",
      arguments: { sessionId, startRow: 0, startCol: 0, endRow: 5, endCol: 20 },
    });
    expect(regionResult.isError).toBeFalsy();
    const regionContent = regionResult.content as Array<{ type: string; data?: string; mimeType?: string }>;
    const image = regionContent.find((c) => c.type === "image");
    expect(image).toBeTruthy();
    expect(image!.mimeType).toBe("image/png");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("capture_baseline and diff_screenshot detect changes", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 1000));

    // Capture baseline
    const baselineResult = await client.callTool({
      name: "capture_baseline",
      arguments: { sessionId },
    });
    expect(baselineResult.isError).toBeFalsy();
    const baselineText = (baselineResult.content as Array<{ type: string; text?: string }>)[0].text!;
    expect(baselineText).toContain("Baseline captured");

    // Type something to change the terminal
    await client.callTool({ name: "send_text", arguments: { sessionId, text: "hello" } });
    await new Promise((r) => setTimeout(r, 500));

    // Diff should show changes
    const diffResult = await client.callTool({
      name: "diff_screenshot",
      arguments: { sessionId },
    });
    expect(diffResult.isError).toBeFalsy();
    const diffContent = diffResult.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    const diffImage = diffContent.find((c) => c.type === "image");
    expect(diffImage).toBeTruthy();
    const diffText = diffContent.find((c) => c.type === "text");
    expect(diffText!.text).toContain("cells changed");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("diff_screenshot errors with no baseline", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    const diffResult = await client.callTool({
      name: "diff_screenshot",
      arguments: { sessionId },
    });
    expect(diffResult.isError).toBe(true);

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("get_cell_info returns cell attributes", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 1000));

    // The echo app shows a green ">" at row 0, col 0
    const cellResult = await client.callTool({
      name: "get_cell_info",
      arguments: { sessionId, row: 0, col: 0 },
    });
    expect(cellResult.isError).toBeFalsy();
    const cellContent = (cellResult.content as Array<{ type: string; text?: string }>)[0].text!;
    const cellInfo = JSON.parse(cellContent);
    expect(cellInfo.char).toBe(">");
    expect(cellInfo.fg).not.toBe("#cccccc"); // should be green, not default
    expect(cellInfo).toHaveProperty("bold");
    expect(cellInfo).toHaveProperty("italic");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("read_scrollback returns empty when no scrollback", async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 500));

    const scrollResult = await client.callTool({
      name: "read_scrollback",
      arguments: { sessionId },
    });
    expect(scrollResult.isError).toBeFalsy();
    const scrollText = (scrollResult.content as Array<{ type: string; text?: string }>)[0].text!;
    expect(scrollText).toBe("No scrollback content available");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("start_recording and stop_recording return a GIF", { timeout: 15000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    await new Promise((r) => setTimeout(r, 500));

    const startResult = await client.callTool({
      name: "start_recording",
      arguments: { sessionId },
    });
    expect(startResult.isError).toBeFalsy();

    // Type something to trigger output and frames
    await client.callTool({ name: "send_text", arguments: { sessionId, text: "hello" } });
    await new Promise((r) => setTimeout(r, 500));
    await client.callTool({ name: "send_keys", arguments: { sessionId, keys: "Enter" } });
    await new Promise((r) => setTimeout(r, 500));

    const stopResult = await client.callTool({
      name: "stop_recording",
      arguments: { sessionId },
    });
    expect(stopResult.isError).toBeFalsy();
    const gifContent = stopResult.content as Array<{ type: string; data?: string; mimeType?: string }>;
    const gif = gifContent.find((c) => c.type === "image");
    expect(gif).toBeTruthy();
    expect(gif!.mimeType).toBe("image/gif");
    // GIF magic bytes: 47 49 46 (GIF)
    const gifBuffer = Buffer.from(gif!.data!, "base64");
    expect(gifBuffer[0]).toBe(0x47); // G
    expect(gifBuffer[1]).toBe(0x49); // I
    expect(gifBuffer[2]).toBe(0x46); // F

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("wait_for_color finds the green prompt", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    // The echo app prints a green ">" — green is palette index 2 = #00cd00
    const colorResult = await client.callTool({
      name: "wait_for_color",
      arguments: { sessionId, color: "green", timeoutMs: 5000 },
    });
    expect(colorResult.isError).toBeFalsy();
    const colorText = (colorResult.content as Array<{ type: string; text?: string }>)[0].text!;
    expect(colorText).toContain("Found");

    await client.callTool({ name: "close", arguments: { sessionId } });
  });

  it("wait_for_color times out on missing color", { timeout: 10000 }, async () => {
    const launchResult = await client.callTool({
      name: "launch",
      arguments: { command: "node", args: [ECHO_APP] },
    });
    const content = launchResult.content as Array<{ type: string; text?: string }>;
    const { sessionId } = JSON.parse(content.find((c) => c.type === "text")!.text!);

    const colorResult = await client.callTool({
      name: "wait_for_color",
      arguments: { sessionId, color: "#ff00ff", timeoutMs: 500 },
    });
    expect(colorResult.isError).toBe(true);

    await client.callTool({ name: "close", arguments: { sessionId } });
  });
});
