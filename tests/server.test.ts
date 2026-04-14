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

  it("lists all 9 tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("launch");
    expect(names).toContain("screenshot");
    expect(names).toContain("read_text");
    expect(names).toContain("wait_for_text");
    expect(names).toContain("wait_for_idle");
    expect(names).toContain("send_keys");
    expect(names).toContain("send_text");
    expect(names).toContain("list_sessions");
    expect(names).toContain("close");
    expect(result.tools).toHaveLength(9);
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
});
