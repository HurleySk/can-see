import { Session, type SessionOptions } from "./session.js";
import type { SessionInfo } from "./types.js";

export class SessionManager {
  private sessions = new Map<string, Session>();
  private idleTimeoutMs: number;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(idleTimeoutMs: number = 300_000) {
    this.idleTimeoutMs = idleTimeoutMs;

    const sweepInterval = Math.min(30_000, Math.floor(idleTimeoutMs / 2));
    this.sweepTimer = setInterval(() => this.sweepIdle(), sweepInterval);
    this.sweepTimer.unref?.();
  }

  launch(
    command: string,
    args: string[] = [],
    options: SessionOptions = {}
  ): string {
    const session = new Session(command, args, options);
    this.sessions.set(session.sessionId, session);
    return session.sessionId;
  }

  get(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => s.getInfo());
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    session.close();
    this.sessions.delete(sessionId);
  }

  closeAllSessions(): number {
    const count = this.sessions.size;
    for (const session of this.sessions.values()) {
      try { session.close(); } catch {}
    }
    this.sessions.clear();
    return count;
  }

  closeAll(): void {
    this.closeAllSessions();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
    }
  }

  sweepIdle(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.getLastActivity() > this.idleTimeoutMs) {
        session.close();
        this.sessions.delete(id);
      }
    }
  }
}
