const SPECIAL_KEYS: Record<string, string> = {
  Enter: "\r",
  Tab: "\t",
  Escape: "\x1b",
  Backspace: "\x7f",
  Space: " ",
  Up: "\x1b[A",
  Down: "\x1b[B",
  Right: "\x1b[C",
  Left: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
};

function resolveSingleKey(key: string): string {
  if (SPECIAL_KEYS[key] !== undefined) {
    return SPECIAL_KEYS[key];
  }

  const ctrlMatch = key.match(/^Ctrl\+([A-Za-z])$/);
  if (ctrlMatch) {
    const letter = ctrlMatch[1].toUpperCase();
    const code = letter.charCodeAt(0) - 64;
    return String.fromCharCode(code);
  }

  if (/^Ctrl\+/.test(key)) {
    throw new Error(`Unknown key: "${key}"`);
  }

  return key;
}

export function resolveKeys(keys: string | string[]): string {
  if (Array.isArray(keys)) {
    return keys.map(resolveSingleKey).join("");
  }
  return resolveSingleKey(keys);
}
