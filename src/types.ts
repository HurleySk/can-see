export interface SessionInfo {
  sessionId: string;
  command: string;
  args: string[];
  status: "running" | "exited";
  exitCode?: number;
  signal?: string;
  cols: number;
  rows: number;
  createdAt: string;
}

export interface LaunchParams {
  command: string;
  args?: string[];
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface ScreenshotResult {
  image: string; // base64 PNG
  status: "running" | "exited";
  exitCode?: number;
  signal?: string;
}

export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 30;
export const DEFAULT_IDLE_TIMEOUT_MS = 300_000; // 5 minutes
