#!/usr/bin/env node
// decoy-tripwire proxy — local MCP proxy. Intercepts tool calls, enforces policy,
// reports decisions to decoy.run. Phase 1: single upstream, stdio only, observe mode.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DECOY_URL,
  createSession,
  createFramer,
  writeLine,
  emitDecoyEvent,
  classifySeverity,
  shortHash,
  PROXY_HONEY_TOOLS,
} from "./shared.mjs";
import { spawnUpstream } from "./upstream.mjs";
import { createPolicyEngine } from "./policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
let PKG_VERSION = "0.0.0";
try { PKG_VERSION = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version; } catch {}

const HONEY_NAMES = new Set(PROXY_HONEY_TOOLS.map(t => t.name));

export async function runProxy(options) {
  const {
    command,
    args = [],
    env = {},
    mode = null,
    decoys = true,
    prefix = null,
    upstreamName = command,
    token = process.env.DECOY_TOKEN || "",
    decoyUrl = DECOY_URL,
  } = options;

  if (!command) {
    process.stderr.write("[decoy-proxy] no upstream command provided\n");
    process.exit(2);
  }

  const session = createSession();
  const policy = createPolicyEngine({ url: decoyUrl, token, forceMode: mode });

  let upstreamToolsCache = [];
  const clientStdin = process.stdin;
  const clientFramer = createFramer();
  let upstreamReadyPromise = null;

  const upstream = spawnUpstream({
    command,
    args,
    env,
    clientInfo: { name: "decoy-tripwire-proxy", version: PKG_VERSION },
    onMessage: (msg) => {
      // Notifications and upstream-initiated requests flow back to the client as-is.
      if (msg.method === "notifications/tools/list_changed") {
        refreshUpstreamTools().catch(() => {});
      }
      writeLine(process.stdout, msg);
    },
    onExit: ({ code, signal, stderrHint }) => {
      process.stderr.write(`[decoy-proxy] upstream exited (code=${code}, signal=${signal})${stderrHint ? ": " + stderrHint : ""}\n`);
      shutdown(code === 0 ? 0 : 1);
    },
  });

  // Policy fetch and upstream handshake are independent — run them in parallel
  // so the client's first initialize doesn't pay for both serially.
  upstreamReadyPromise = (async () => {
    await upstream.ready();
    await refreshUpstreamTools();
  })();
  const initialRefresh = await policy.refresh();
  if (!initialRefresh.ok && token) {
    process.stderr.write(`[decoy-proxy] policy fetch failed (${initialRefresh.reason}); using cache/defaults\n`);
  }
  policy.startRefreshLoop();

  async function refreshUpstreamTools() {
    try {
      const result = await upstream.call("tools/list", {});
      const tools = Array.isArray(result?.tools) ? result.tools : [];
      upstreamToolsCache = prefix ? tools.map(t => ({ ...t, name: `${prefix}${t.name}` })) : tools;
    } catch (e) {
      process.stderr.write(`[decoy-proxy] tools/list refresh failed: ${e.message}\n`);
    }
  }

  // Mirrors decoy-app's resolveAgent fingerprint. Cached after initialize so the
  // hash runs once per session instead of per tools/call.
  function ensureAgentId() {
    if (session.agentId) return session.agentId;
    const raw = `${session.clientName || ""}${session.clientVersion || ""}`;
    session.agentId = shortHash(raw, 16);
    return session.agentId;
  }

  function buildToolsList() {
    const realTools = upstreamToolsCache.map(t => ({ ...t }));
    const aId = ensureAgentId();
    // Filter by policy — hide denied tools from the listing under enforce mode.
    const filtered = realTools.filter(t => {
      const d = policy.decide({ toolName: t.name, args: {}, upstreamName, agentId: aId });
      if (d.mode === "enforce" && d.decision === "deny") return false;
      return true;
    });
    return decoys ? [...filtered, ...PROXY_HONEY_TOOLS] : filtered;
  }

  function reportDecision({ toolName, args, decision, reason, ruleId }) {
    const severity = classifySeverity(toolName, HONEY_NAMES);
    process.stderr.write(JSON.stringify({
      event: "proxy.decision",
      tool: toolName,
      upstream: upstreamName,
      decision,
      reason,
      severity,
      sequence: session.toolCallCount,
      clientName: session.clientName,
      timestamp: new Date().toISOString(),
    }) + "\n");
    if (!token) return;
    const payload = {
      jsonrpc: "2.0",
      method: "notifications/decoy.decision",
      params: {
        decision,
        reason,
        toolName,
        arguments: args,
        upstreamName,
        ruleId: ruleId || null,
        severity,
      },
      meta: {
        clientName: session.clientName,
        clientVersion: session.clientVersion,
        protocolVersion: session.protocolVersion,
        sessionDuration: Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000),
        toolCallSequence: session.toolCallCount,
      },
    };
    emitDecoyEvent(token, payload, decoyUrl);
  }

  async function handleClientMessage(msg) {
    const { method, id, params } = msg;

    if (method === "initialize") {
      session.clientName = params?.clientInfo?.name || null;
      session.clientVersion = params?.clientInfo?.version || null;
      session.protocolVersion = params?.protocolVersion || null;
      session.capabilities = params?.capabilities || null;
      process.stderr.write(JSON.stringify({
        event: "session.start",
        clientName: session.clientName,
        clientVersion: session.clientVersion,
        upstream: upstreamName,
        timestamp: session.startedAt,
      }) + "\n");

      // upstream.ready() was kicked off in parallel during runProxy startup; await
      // the result here so tools/list can't race ahead of a live upstream.
      try {
        await upstreamReadyPromise;
      } catch (e) {
        process.stderr.write(`[decoy-proxy] upstream initialize failed: ${e.message}\n`);
        writeLine(process.stdout, {
          jsonrpc: "2.0", id,
          error: { code: -32603, message: `upstream unavailable: ${e.message}` },
        });
        return;
      }

      writeLine(process.stdout, {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: session.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: `decoy-proxy(${upstreamName})`, version: PKG_VERSION },
        },
      });
      return;
    }

    if (method === "notifications/initialized") {
      upstream.notify("notifications/initialized", params || {});
      return;
    }

    if (method === "tools/list") {
      writeLine(process.stdout, { jsonrpc: "2.0", id, result: { tools: buildToolsList() } });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const args = params?.arguments || {};

      session.toolCallCount++;

      // Decoy tools — handle locally, always report as a trigger.
      if (HONEY_NAMES.has(toolName)) {
        reportDecision({ toolName, args, decision: "honeypot", reason: "honeypot_hit" });
        writeLine(process.stdout, {
          jsonrpc: "2.0", id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ status: "error", error: "operation not permitted" }) }],
            isError: true,
          },
        });
        return;
      }

      const d = policy.decide({ toolName, args, upstreamName, agentId: ensureAgentId() });
      reportDecision({ toolName, args, decision: d.decision, reason: d.reason, ruleId: d.ruleId });

      if (d.decision === "deny" && d.mode === "enforce") {
        writeLine(process.stdout, {
          jsonrpc: "2.0", id,
          result: {
            content: [{ type: "text", text: `Blocked by Decoy policy: ${d.reason}` }],
            isError: true,
          },
        });
        return;
      }

      // Forward to upstream — strip proxy-added prefix before forwarding.
      const forwardName = prefix && toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
      upstream.writeRaw({
        jsonrpc: "2.0", id, method: "tools/call",
        params: { name: forwardName, arguments: args },
      });
      return;
    }

    // Pass-through for every other method (resources/*, prompts/*, ping, etc.)
    upstream.writeRaw(msg);
  }

  clientStdin.on("data", (chunk) => {
    const messages = clientFramer.push(chunk);
    for (const msg of messages) {
      handleClientMessage(msg).catch(e => {
        process.stderr.write(`[decoy-proxy] client message handler threw: ${e.message}\n`);
      });
    }
  });

  clientStdin.on("end", () => shutdown(0));

  let shuttingDown = false;
  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    try { policy.stop(); } catch {}
    try { upstream.stop(); } catch {}
    process.exit(code);
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

// Allow direct invocation via `node server/proxy.mjs -- <upstream-cmd> <args>`.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/proxy.mjs");
if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const sepIdx = argv.indexOf("--");
  const flags = sepIdx === -1 ? argv : argv.slice(0, sepIdx);
  const upstreamArgv = sepIdx === -1 ? [] : argv.slice(sepIdx + 1);
  const options = parseFlags(flags);
  options.command = upstreamArgv[0];
  options.args = upstreamArgv.slice(1);
  runProxy(options);
}

function parseFlags(flags) {
  const opts = {};
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "--mode") opts.mode = flags[++i];
    else if (f === "--no-decoys") opts.decoys = false;
    else if (f === "--decoys") opts.decoys = true;
    else if (f === "--prefix") opts.prefix = flags[++i];
    else if (f === "--name") opts.upstreamName = flags[++i];
  }
  return opts;
}
