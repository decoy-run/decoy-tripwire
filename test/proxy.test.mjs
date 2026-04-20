// End-to-end proxy test — spawns bin/cli.mjs `proxy`, which wraps a stub upstream node script.
// Run: node --test test/proxy.test.mjs

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "bin", "cli.mjs");

// Stub upstream: a minimal MCP server that answers initialize, tools/list, tools/call.
function makeStubUpstream() {
  const dir = join(tmpdir(), `decoy-proxy-test-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "stub.mjs");
  const src = `
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\\n")) !== -1) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "0" } } }) + "\\n");
    } else if (msg.method === "tools/list") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [ { name: "echo", description: "echo", inputSchema: { type: "object", properties: { text: { type: "string" } } } } ] } }) + "\\n");
    } else if (msg.method === "tools/call") {
      const text = msg.params?.arguments?.text || "";
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "echoed:" + text }] } }) + "\\n");
    } else if (msg.method && msg.method.startsWith("notifications/")) {
      // no-op
    } else if (msg.id !== undefined) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } }) + "\\n");
    }
  }
});
`;
  writeFileSync(path, src);
  return path;
}

function startProxy(upstream, extraArgs = []) {
  const proc = spawn("node", [CLI, "proxy", ...extraArgs, "--", "node", upstream], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      DECOY_TOKEN: "",
      DECOY_URL: "http://localhost:0",
    },
  });
  return proc;
}

function send(proc, msg) { proc.stdin.write(JSON.stringify(msg) + "\n"); }

function readUntilId(proc, targetId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for id=${targetId}`)); }, timeoutMs);
    function onData(chunk) {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === targetId) { cleanup(); return resolve(msg); }
      }
    }
    function cleanup() { clearTimeout(timer); proc.stdout.off("data", onData); }
    proc.stdout.on("data", onData);
  });
}

describe("proxy end-to-end", () => {
  const stub = makeStubUpstream();
  const procs = [];
  after(() => { for (const p of procs) try { p.kill(); } catch {} });

  it("initializes, lists tools (upstream + decoys), and forwards a tools/call", async () => {
    const proc = startProxy(stub);
    procs.push(proc);

    const initResp = await (async () => { send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "test", version: "0" } } }); return readUntilId(proc, 1); })();
    assert.equal(initResp.result.serverInfo.name.startsWith("decoy-proxy"), true);

    send(proc, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });

    send(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResp = await readUntilId(proc, 2);
    const names = listResp.result.tools.map(t => t.name);
    assert.ok(names.includes("echo"), `expected echo tool, got ${names.join(",")}`);
    assert.ok(names.includes("access_credentials"), "decoys should be present by default");

    send(proc, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
    const callResp = await readUntilId(proc, 3);
    assert.equal(callResp.result.content[0].text, "echoed:hi");
  });

  it("--no-decoys hides decoy tools from tools/list", async () => {
    const proc = startProxy(stub, ["--no-decoys"]);
    procs.push(proc);

    send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "test", version: "0" } } });
    await readUntilId(proc, 1);
    send(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listResp = await readUntilId(proc, 2);
    const names = listResp.result.tools.map(t => t.name);
    assert.ok(names.includes("echo"));
    assert.ok(!names.includes("access_credentials"), "decoys should be hidden");
  });

  it("honeypot tool call returns synthetic error and does not reach upstream", async () => {
    const proc = startProxy(stub);
    procs.push(proc);

    send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "test", version: "0" } } });
    await readUntilId(proc, 1);
    send(proc, { jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "access_credentials", arguments: { name: "aws-root" } } });
    const resp = await readUntilId(proc, 10);
    assert.equal(resp.result.isError, true);
    assert.match(resp.result.content[0].text, /operation not permitted/);
  });
});
