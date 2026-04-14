// src/diff.ts
import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
import { resolveColor } from "./colors.js";

export interface CellSnapshot {
  char: string;
  fg: string;
  bg: string;
}

export interface DiffResult {
  highlights: Map<string, string>;
  changedCells: number;
  changedRowRange: [number, number] | null; // [minRow, maxRow] or null if no changes
}

/**
 * Capture a snapshot of the visible viewport — char + resolved colors per cell.
 */
export function captureBuffer(terminal: Terminal): CellSnapshot[][] {
  const buffer = terminal.buffer.active;
  const rows = terminal.rows;
  const cols = terminal.cols;
  const snapshot: CellSnapshot[][] = [];

  for (let row = 0; row < rows; row++) {
    const line = buffer.getLine(row);
    const rowCells: CellSnapshot[] = [];
    for (let col = 0; col < cols; col++) {
      const cell = line?.getCell(col);
      if (!cell) {
        rowCells.push({ char: " ", fg: "#cccccc", bg: "#1e1e1e" });
        continue;
      }
      rowCells.push({
        char: cell.getChars() || " ",
        fg: resolveColor(cell, "fg"),
        bg: resolveColor(cell, "bg"),
      });
    }
    snapshot.push(rowCells);
  }
  return snapshot;
}

/**
 * Compare two buffer snapshots cell-by-cell. Returns a highlight map
 * compatible with RenderOptions.highlights.
 */
export function diffBuffers(before: CellSnapshot[][], after: CellSnapshot[][]): DiffResult {
  const highlights = new Map<string, string>();
  let changedCells = 0;
  let minRow = Infinity;
  let maxRow = -1;

  const rows = Math.min(before.length, after.length);
  for (let row = 0; row < rows; row++) {
    const cols = Math.min(before[row].length, after[row].length);
    for (let col = 0; col < cols; col++) {
      const b = before[row][col];
      const a = after[row][col];
      if (b.char !== a.char || b.fg !== a.fg || b.bg !== a.bg) {
        highlights.set(`${row},${col}`, "rgba(255, 0, 0, 0.4)");
        changedCells++;
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
      }
    }
  }

  return {
    highlights,
    changedCells,
    changedRowRange: changedCells > 0 ? [minRow, maxRow] : null,
  };
}
