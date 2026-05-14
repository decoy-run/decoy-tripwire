// Canonical MCP-host config-path table for decoy-tripwire.
//
// Previously this lived in two places: a keyed `HOSTS` object with lazy
// `configPath()` fns in bin/cli.mjs, and an array-returning
// `getHostConfigs()` in server/server.mjs (whose comment even said
// "inline from cli.mjs"). Cline was missing from one, present in the
// other — exactly the drift this consolidation prevents.
//
// homedir()/platform() are fixed for a process lifetime, so paths are
// resolved eagerly at import. Shape: { slug: { name, path, format } }.

import { homedir, platform } from "node:os";
import { join } from "node:path";

function resolve(darwin, win32, linux) {
  const p = platform();
  if (p === "darwin") return darwin();
  if (p === "win32") return win32();
  return linux();
}

const home = homedir();

export const HOSTS = {
  "claude-desktop": {
    name: "Claude Desktop",
    format: "mcpServers",
    path: resolve(
      () => join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
      () => join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
      () => join(home, ".config", "Claude", "claude_desktop_config.json"),
    ),
  },
  "cursor": {
    name: "Cursor",
    format: "mcpServers",
    path: resolve(
      () => join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "anysphere.cursor-mcp", "mcp.json"),
      () => join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "anysphere.cursor-mcp", "mcp.json"),
      () => join(home, ".config", "Cursor", "User", "globalStorage", "anysphere.cursor-mcp", "mcp.json"),
    ),
  },
  "windsurf": {
    name: "Windsurf",
    format: "mcpServers",
    path: resolve(
      () => join(home, "Library", "Application Support", "Windsurf", "User", "globalStorage", "codeium.windsurf-mcp", "mcp.json"),
      () => join(home, "AppData", "Roaming", "Windsurf", "User", "globalStorage", "codeium.windsurf-mcp", "mcp.json"),
      () => join(home, ".config", "Windsurf", "User", "globalStorage", "codeium.windsurf-mcp", "mcp.json"),
    ),
  },
  "vscode": {
    name: "VS Code",
    format: "mcp.servers",
    path: resolve(
      () => join(home, "Library", "Application Support", "Code", "User", "settings.json"),
      () => join(home, "AppData", "Roaming", "Code", "User", "settings.json"),
      () => join(home, ".config", "Code", "User", "settings.json"),
    ),
  },
  "claude-code": {
    name: "Claude Code",
    format: "mcpServers",
    path: join(home, ".claude.json"),
  },
};

// Array view for callers that iterate hosts without needing the slug key.
export function getHostConfigs() {
  return Object.values(HOSTS);
}
