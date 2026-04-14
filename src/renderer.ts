import xtermHeadless from "@xterm/headless";
const { Terminal } = xtermHeadless;
type Terminal = InstanceType<typeof Terminal>;
import { createCanvas } from "canvas";
import { ANSI_COLORS, DEFAULT_BG, DEFAULT_FG, paletteColor, rgbColor } from "./colors.js";

const CELL_WIDTH = 9;
const CELL_HEIGHT = 18;
const FONT_SIZE = 14;
const FONT_FAMILY = "monospace";
const PADDING = 8;

export function renderTerminal(terminal: Terminal): Buffer {
  const cols = terminal.cols;
  const rows = terminal.rows;
  const buffer = terminal.buffer.active;

  const canvasWidth = cols * CELL_WIDTH + PADDING * 2;
  const canvasHeight = rows * CELL_HEIGHT + PADDING * 2;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = DEFAULT_BG;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.textBaseline = "top";

  for (let row = 0; row < rows; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;

    for (let col = 0; col < cols; col++) {
      const cell = line.getCell(col);
      if (!cell) continue;

      const char = cell.getChars();
      const x = PADDING + col * CELL_WIDTH;
      const y = PADDING + row * CELL_HEIGHT;

      const isBold = !!cell.isBold();
      const isItalic = !!cell.isItalic();
      const isInverse = !!cell.isInverse();

      let fg: string;
      if (cell.isFgDefault()) {
        fg = DEFAULT_FG;
      } else if (cell.isFgRGB()) {
        fg = rgbColor(cell.getFgColor());
      } else if (cell.isFgPalette()) {
        fg = paletteColor(cell.getFgColor());
      } else {
        fg = DEFAULT_FG;
      }

      let bg: string;
      if (cell.isBgDefault()) {
        bg = DEFAULT_BG;
      } else if (cell.isBgRGB()) {
        bg = rgbColor(cell.getBgColor());
      } else if (cell.isBgPalette()) {
        bg = paletteColor(cell.getBgColor());
      } else {
        bg = DEFAULT_BG;
      }

      if (isInverse) {
        [fg, bg] = [bg, fg];
      }

      if (bg !== DEFAULT_BG) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, CELL_WIDTH, CELL_HEIGHT);
      }

      if (char && char !== " ") {
        const fontStyle = `${isItalic ? "italic " : ""}${isBold ? "bold " : ""}${FONT_SIZE}px ${FONT_FAMILY}`;
        ctx.font = fontStyle;
        ctx.fillStyle = fg;
        ctx.fillText(char, x, y + 2);
      }
    }
  }

  const cursorX = PADDING + buffer.cursorX * CELL_WIDTH;
  const cursorY = PADDING + buffer.cursorY * CELL_HEIGHT;
  ctx.fillStyle = DEFAULT_FG;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(cursorX, cursorY, CELL_WIDTH, CELL_HEIGHT);
  ctx.globalAlpha = 1.0;

  return canvas.toBuffer("image/png");
}
