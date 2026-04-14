import { describe, it, expect, afterEach } from "vitest";
import { Session } from "../src/session.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_APP = path.join(__dirname, "fixtures", "echo-app.js");

describe("Session", () => {
  let session: Session;

  afterEach(async () => {
    if (session) {
      try { session.close(); } catch {}
    }
  });

  it("launches a process and reports running status", () => {
    session = new Session("node", [ECHO_APP], { cols: 40, rows: 10 });
    const info = session.getInfo();
    expect(info.status).toBe("running");
    expect(info.command).toBe("node");
    expect(info.cols).toBe(40);
    expect(info.rows).toBe(10);
  });

  it("captures output into the terminal buffer", async () => {
    session = new Session("node", [ECHO_APP], { cols: 40, rows: 10 });
    await waitForOutput(session, ">", 3000);
    const screenshot = session.screenshot();
    expect(screenshot.length).toBeGreaterThan(0);
  });

  it("sends keystrokes and captures response", async () => {
    session = new Session("node", [ECHO_APP], { cols: 40, rows: 10 });
    await waitForOutput(session, ">", 3000);
    session.write("hi");
    await waitForOutput(session, "hi", 3000);
    const screenshot = session.screenshot();
    expect(screenshot.length).toBeGreaterThan(0);
  });

  it("detects when the process exits", async () => {
    session = new Session("node", ["-e", "process.exit(42)"], { cols: 40, rows: 10 });
    await waitForExit(session, 3000);
    const info = session.getInfo();
    expect(info.status).toBe("exited");
    expect(info.exitCode).toBe(42);
  });

  it("close kills the process", async () => {
    session = new Session("node", [ECHO_APP], { cols: 40, rows: 10 });
    await waitForOutput(session, ">", 3000);
    session.close();
    await new Promise((r) => setTimeout(r, 500));
    expect(session.getInfo().status).toBe("exited");
  });
});

async function waitForOutput(session: Session, text: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (session.getBufferText().includes(text)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for "${text}" in terminal output`);
}

async function waitForExit(session: Session, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (session.getInfo().status === "exited") return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out waiting for process exit");
}
