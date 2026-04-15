import { describe, it, expect, afterEach } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ECHO_APP = path.join(__dirname, "fixtures", "echo-app.js");

describe("SessionManager", { timeout: 15000 }, () => {
  let manager: SessionManager;

  afterEach(() => {
    if (manager) {
      manager.closeAll();
    }
  });

  it("launches a session and returns a sessionId", () => {
    manager = new SessionManager();
    const sessionId = manager.launch("node", [ECHO_APP]);
    expect(sessionId).toBeTruthy();
    expect(typeof sessionId).toBe("string");
  });

  it("lists active sessions", () => {
    manager = new SessionManager();
    const id1 = manager.launch("node", [ECHO_APP]);
    const id2 = manager.launch("node", [ECHO_APP]);
    const sessions = manager.list();
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.sessionId)).toContain(id1);
    expect(sessions.map((s) => s.sessionId)).toContain(id2);
  });

  it("gets a session by id", () => {
    manager = new SessionManager();
    const sessionId = manager.launch("node", [ECHO_APP]);
    const session = manager.get(sessionId);
    expect(session).toBeTruthy();
    expect(session.getInfo().sessionId).toBe(sessionId);
  });

  it("throws on invalid sessionId", () => {
    manager = new SessionManager();
    expect(() => manager.get("nonexistent")).toThrow("Session not found");
  });

  it("closes a session and removes it from the list", async () => {
    manager = new SessionManager();
    const sessionId = manager.launch("node", [ECHO_APP]);
    manager.close(sessionId);
    await new Promise((r) => setTimeout(r, 500));
    expect(manager.list()).toHaveLength(0);
  });

  it("cleans up idle sessions", async () => {
    manager = new SessionManager(100); // 100ms idle timeout
    const sessionId = manager.launch("node", [ECHO_APP]);
    expect(manager.list()).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 500));
    manager.sweepIdle();
    expect(manager.list()).toHaveLength(0);
  });
});
