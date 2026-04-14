/**
 * Smithery configuration for can-see MCP server.
 * @param {object} config - User configuration (currently unused).
 * @returns {{ command: string, args: string[] }} Spawn command for the server.
 */
export default function startServer(config) {
  return {
    command: "npx",
    args: ["-y", "can-see"],
  };
}
