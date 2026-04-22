// Tests for init's wrap-existing-servers logic. The helpers live inside
// bin/cli.mjs (private), so we re-implement the same logic against a copy
// here — the goal is to pin the behavior, not test the private exports.
//
// When cli.mjs ever grows a proper library split, these tests should
// migrate to import the real helpers directly.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Keep in sync with bin/cli.mjs — if that logic changes, update here and
// wire a real import when possible.
function wrapExistingServers(servers, installDir, token) {
  const proxyPath = `${installDir}/proxy.mjs`;
  const wrapped = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (name === "system-tools") continue;
    if (Array.isArray(entry?.args) && entry.args.some(a => typeof a === "string" && a.startsWith(installDir))) continue;
    if (!entry?.command) continue;
    const originalArgs = Array.isArray(entry.args) ? entry.args : [];
    servers[name] = {
      command: "node",
      args: [proxyPath, "--name", name, "--", entry.command, ...originalArgs],
      env: { ...(entry.env || {}), DECOY_TOKEN: token },
    };
    wrapped.push(name);
  }
  return wrapped;
}

const INSTALL_DIR = "/home/u/.config/Cursor/decoy";
const TOKEN = "t0k3n";

describe("wrapExistingServers", () => {
  it("wraps a plain upstream through the proxy", () => {
    const servers = {
      filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },
    };
    const wrapped = wrapExistingServers(servers, INSTALL_DIR, TOKEN);
    assert.deepStrictEqual(wrapped, ["filesystem"]);
    assert.strictEqual(servers.filesystem.command, "node");
    assert.deepStrictEqual(servers.filesystem.args, [
      `${INSTALL_DIR}/proxy.mjs`, "--name", "filesystem", "--",
      "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp",
    ]);
    assert.strictEqual(servers.filesystem.env.DECOY_TOKEN, TOKEN);
  });

  it("preserves the upstream's existing env vars", () => {
    const servers = {
      stripe: { command: "npx", args: ["@stripe/mcp"], env: { STRIPE_API_KEY: "sk_test" } },
    };
    wrapExistingServers(servers, INSTALL_DIR, TOKEN);
    assert.strictEqual(servers.stripe.env.STRIPE_API_KEY, "sk_test");
    assert.strictEqual(servers.stripe.env.DECOY_TOKEN, TOKEN);
  });

  it("skips the system-tools entry (our own tripwire server)", () => {
    const servers = {
      "system-tools": { command: "node", args: [`${INSTALL_DIR}/server.mjs`], env: { DECOY_TOKEN: TOKEN } },
      filesystem: { command: "npx", args: ["-y", "fs"] },
    };
    const wrapped = wrapExistingServers(servers, INSTALL_DIR, TOKEN);
    assert.deepStrictEqual(wrapped, ["filesystem"]);
    assert.deepStrictEqual(servers["system-tools"].args, [`${INSTALL_DIR}/server.mjs`]);
  });

  it("is idempotent — does not double-wrap an already-proxied entry", () => {
    const servers = {
      filesystem: { command: "npx", args: ["-y", "fs"] },
    };
    wrapExistingServers(servers, INSTALL_DIR, TOKEN);
    const wrappedArgs = [...servers.filesystem.args];
    const second = wrapExistingServers(servers, INSTALL_DIR, TOKEN);
    assert.deepStrictEqual(second, [], "second pass should wrap nothing");
    assert.deepStrictEqual(servers.filesystem.args, wrappedArgs, "args should be unchanged");
  });

  it("ignores entries without a command", () => {
    const servers = {
      broken: { args: ["some", "args"] },
      ok: { command: "npx", args: ["-y", "fs"] },
    };
    const wrapped = wrapExistingServers(servers, INSTALL_DIR, TOKEN);
    assert.deepStrictEqual(wrapped, ["ok"]);
    assert.deepStrictEqual(servers.broken, { args: ["some", "args"] });
  });
});
