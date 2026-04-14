// A simple app that prints a prompt, reads input, and echoes it back.
process.stdout.write("\x1b[32m> \x1b[0m");

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");

process.stdin.on("data", (data) => {
  if (data === "\x03") {
    process.stdout.write("\r\nBye!\r\n");
    process.exit(0);
  }
  if (data === "\r" || data === "\n") {
    process.stdout.write("\r\n\x1b[32m> \x1b[0m");
    return;
  }
  process.stdout.write(data);
});
