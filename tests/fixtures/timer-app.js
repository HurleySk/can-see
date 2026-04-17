// Prints "Ready" on first line, then updates a counter on row 29 every second.
// Simulates an Ink/TUI app with a timer-driven re-render.
process.stdout.write("\x1b[32m> \x1b[0mReady\r\n");
let count = 0;
setInterval(() => {
  // Move cursor to row 30 (1-based ANSI), clear line, write counter
  process.stdout.write(`\x1b[30;1H\x1b[2KElapsed: ${++count}s`);
}, 1000);
