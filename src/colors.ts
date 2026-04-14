// src/colors.ts

export const ANSI_COLORS: string[] = [
  "#000000", "#cd0000", "#00cd00", "#cdcd00",
  "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  "#7f7f7f", "#ff0000", "#00ff00", "#ffff00",
  "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
];

export const DEFAULT_BG = "#1e1e1e";
export const DEFAULT_FG = "#cccccc";

export function paletteColor(index: number): string {
  if (index >= 0 && index <= 15) {
    return ANSI_COLORS[index];
  }

  if (index >= 16 && index <= 231) {
    const idx = index - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    return `rgb(${r ? r * 40 + 55 : 0}, ${g ? g * 40 + 55 : 0}, ${b ? b * 40 + 55 : 0})`;
  }

  if (index >= 232 && index <= 255) {
    const level = (index - 232) * 10 + 8;
    return `rgb(${level}, ${level}, ${level})`;
  }

  return DEFAULT_FG;
}

export function rgbColor(value: number): string {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Convert any CSS color string (hex, rgb()) to a normalized "#rrggbb" hex string. */
export function toHex(color: string): string {
  if (color.startsWith("#") && color.length === 7) return color.toLowerCase();
  const m = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (m) {
    const r = parseInt(m[1], 10);
    const g = parseInt(m[2], 10);
    const b = parseInt(m[3], 10);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
  return color.toLowerCase();
}

/**
 * Resolve a cell's foreground or background color to a hex string.
 * `cell` must be an xterm IBufferCell.
 */
export function resolveColor(
  cell: { isFgDefault: () => number; isFgRGB: () => number; isFgPalette: () => number; getFgColor: () => number; isBgDefault: () => number; isBgRGB: () => number; isBgPalette: () => number; getBgColor: () => number },
  type: "fg" | "bg",
): string {
  if (type === "fg") {
    if (cell.isFgDefault()) return DEFAULT_FG;
    if (cell.isFgRGB()) return toHex(rgbColor(cell.getFgColor()));
    if (cell.isFgPalette()) return toHex(paletteColor(cell.getFgColor()));
    return DEFAULT_FG;
  } else {
    if (cell.isBgDefault()) return DEFAULT_BG;
    if (cell.isBgRGB()) return toHex(rgbColor(cell.getBgColor()));
    if (cell.isBgPalette()) return toHex(paletteColor(cell.getBgColor()));
    return DEFAULT_BG;
  }
}

/** Map of ANSI color names to hex values (matching ANSI_COLORS palette). */
export const ANSI_NAMES: Record<string, string> = {
  "black": "#000000", "red": "#cd0000", "green": "#00cd00", "yellow": "#cdcd00",
  "blue": "#0000ee", "magenta": "#cd00cd", "cyan": "#00cdcd", "white": "#e5e5e5",
  "bright-black": "#7f7f7f", "bright-red": "#ff0000", "bright-green": "#00ff00", "bright-yellow": "#ffff00",
  "bright-blue": "#5c5cff", "bright-magenta": "#ff00ff", "bright-cyan": "#00ffff", "bright-white": "#ffffff",
};

/** Resolve a user-provided color (hex or ANSI name) to normalized hex. */
export function parseColor(input: string): string {
  const lower = input.toLowerCase().trim();
  if (ANSI_NAMES[lower]) return ANSI_NAMES[lower];
  if (lower.startsWith("#") && lower.length === 7) return lower;
  throw new Error(`Unknown color: "${input}". Use hex (#rrggbb) or ANSI name (red, bright-green, etc.)`);
}
