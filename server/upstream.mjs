// MCP client — spawns an upstream MCP server and speaks JSON-RPC over stdio.
// Vendored env sanitization pattern from decoy-scan/lib/probe.mjs.

import { spawn } from "node:child_process";
import { createFramer } from "./shared.mjs";

const SAFE_ENV_KEYS = ["PATH", "HOME", "NODE_PATH", "TERM", "LANG", "SHELL", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP"];
const DANGEROUS_ENV_KEYS = ["LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "NODE_OPTIONS", "PYTHONPATH", "PYTHONSTARTUP", "RUBYOPT", "PERL5OPT", "BASH_ENV", "ENV"];

function buildEnv(extra = {}) {
  const base = Object.fromEntries(SAFE_ENV_KEYS.filter(k => process.env[k]).map(k => [k, process.env[k]]));
  const cfg = { ...extra };
  for (const k of DANGEROUS_ENV_KEYS) delete cfg[k];
  for (const k of ["PATH", "HOME"]) { if (base[k]) delete cfg[k]; }
  return { ...base, ...cfg };
}

// Spawn an upstream MCP server and return a client handle.
// options: { command, args, env, protocolVersion, clientInfo, onMessage, onExit, initTimeoutMs }
// - onMessage(msg) fires for every JSON-RPC message from upstream that isn't matched to a pending call()
// - onExit({code, signal, stderrHint}) fires when upstream process exits
// Returns { ready, call, notify, writeRaw, stop, child }.
export function spawnUpstream(options) {
  const {
    command,
    args = [],
    env: extraEnv = {},
    protocolVersion = "2024-11-05",
    clientInfo = { name: "decoy-tripwire-proxy", version: "0" },
    onMessage = () => {},
    onExit = () => {},
    initTimeoutMs = 15000,
  } = options;

  const pending = new Map();
  let idCounter = 0;
  const nextId = () => `p-${++idCounter}`;

  let stderrBuf = "";
  let stopped = false;

  const child = spawn(command, args, {
    env: buildEnv(extraEnv),
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
  });

  const framer = createFramer();

  child.stdout.on("data", (chunk) => {
    const messages = framer.push(chunk);
    for (const msg of messages) {
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        clearTimeout(timer);
        pending.delete(msg.id);
        if (msg.error) reject(Object.assign(new Error(msg.error.message || "upstream error"), { rpc: msg.error }));
        else resolve(msg.result);
      } else {
        try { onMessage(msg); } catch (e) { process.stderr.write(`[decoy-proxy] onMessage threw: ${e.message}\n`); }
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString();
    if (stderrBuf.length > 64 * 1024) stderrBuf = stderrBuf.slice(-32 * 1024);
    process.stderr.write(`[upstream] ${chunk}`);
  });

  child.on("error", (e) => {
    if (stopped) return;
    stopped = true;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(e); }
    pending.clear();
    onExit({ code: null, signal: null, stderrHint: e.message });
  });

  child.on("exit", (code, signal) => {
    if (stopped) return;
    stopped = true;
    const err = new Error(`upstream exited (code=${code}, signal=${signal})`);
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(err); }
    pending.clear();
    const hint = stderrBuf.trim().split("\n").pop()?.slice(0, 500) || "";
    onExit({ code, signal, stderrHint: hint });
  });

  function writeRaw(msg) {
    if (stopped || child.stdin.writableEnded) return false;
    try {
      child.stdin.write(JSON.stringify(msg) + "\n");
      return true;
    } catch (e) {
      process.stderr.write(`[decoy-proxy] upstream write failed: ${e.message}\n`);
      return false;
    }
  }

  function call(method, params, timeoutMs = initTimeoutMs) {
    return new Promise((resolve, reject) => {
      if (stopped) return reject(new Error("upstream stopped"));
      const id = nextId();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`upstream ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      if (!writeRaw({ jsonrpc: "2.0", id, method, params })) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("upstream stdin closed"));
      }
    });
  }

  function notify(method, params) {
    writeRaw({ jsonrpc: "2.0", method, params });
  }

  async function ready() {
    const result = await call("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo,
    }, initTimeoutMs);
    notify("notifications/initialized", {});
    return result;
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("upstream stopped"));
    }
    pending.clear();
  }

  return { ready, call, notify, writeRaw, stop, child };
}
