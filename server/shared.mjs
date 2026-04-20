// Shared utilities for decoy-tripwire. Pure — no side effects at import time.
// Used by proxy.mjs; server.mjs still has its own inline copies for now.

import { createHash } from "node:crypto";

export const DECOY_URL = process.env.DECOY_URL || "https://app.decoy.run";

// Severity table mirrors server.mjs:1211-1218.
const CRITICAL = new Set([
  "execute_command", "write_file", "make_payment", "authorize_service", "modify_dns",
]);
const HIGH = new Set([
  "read_file", "http_request", "database_query", "access_credentials", "send_email", "install_package",
]);

export function classifySeverity(toolName, honeyNames) {
  if (honeyNames && honeyNames.has(toolName)) return "critical";
  if (CRITICAL.has(toolName)) return "critical";
  if (HIGH.has(toolName)) return "high";
  return "medium";
}

export function createSession() {
  return {
    clientName: null,
    clientVersion: null,
    protocolVersion: null,
    capabilities: null,
    startedAt: new Date().toISOString(),
    toolCallCount: 0,
    agentId: null,
  };
}

// Stateful line framer — handles both Content-Length framed and newline-delimited JSON.
// Returns { push(chunk) → messages[], reset() }. One framer instance per stream.
export function createFramer() {
  let buf = Buffer.alloc(0);

  function extract() {
    const messages = [];
    while (buf.length > 0) {
      const headerStr = buf.toString("ascii", 0, Math.min(buf.length, 256));
      if (headerStr.startsWith("Content-Length:")) {
        const sep = buf.indexOf("\r\n\r\n");
        if (sep === -1) break;
        const header = buf.slice(0, sep).toString("ascii");
        const m = header.match(/Content-Length:\s*(\d+)/i);
        if (!m) { buf = buf.slice(sep + 4); continue; }
        const contentLength = parseInt(m[1], 10);
        const bodyStart = sep + 4;
        const end = bodyStart + contentLength;
        if (buf.length < end) break;
        const body = buf.slice(bodyStart, end).toString("utf8");
        buf = buf.slice(end);
        try { messages.push(JSON.parse(body)); } catch { /* skip */ }
      } else {
        const nl = buf.indexOf("\n");
        if (nl === -1) break;
        const line = buf.slice(0, nl).toString("utf8").replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try { messages.push(JSON.parse(line)); } catch { /* skip */ }
      }
    }
    return messages;
  }

  return {
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      return extract();
    },
    reset() { buf = Buffer.alloc(0); },
  };
}

export function writeLine(stream, obj) {
  stream.write(JSON.stringify(obj) + "\n");
}

// Fire-and-forget POST to /mcp/{token}. Never throws.
// Proxy decision events use method: "notifications/decoy.decision" with params containing
// { decision, reason, toolName, arguments, upstreamName, ruleId?, meta }.
export async function emitDecoyEvent(token, payload, url = DECOY_URL) {
  if (!token) return;
  try {
    await fetch(`${url}/mcp/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify(payload),
    });
  } catch (e) {
    process.stderr.write(`[decoy-proxy] report failed: ${e.message}\n`);
  }
}

// Hash a string to N hex chars — used for endpoint fingerprints in auto-register flows.
export function shortHash(input, len = 16) {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}

// Compact set of honeypot tools injected into proxy tools/list.
// Smaller than the full server.mjs HONEY_TOOLS set — proxy mode already has real upstream tools,
// so decoys stay minimal to avoid diluting the agent's tool choice. User opts in via --decoys.
export const PROXY_HONEY_TOOLS = [
  {
    name: "access_credentials",
    description: "Read credentials or secrets from the host keychain or credential store.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Credential name" } },
      required: ["name"],
    },
  },
  {
    name: "make_payment",
    description: "Authorize a payment through the configured payment provider.",
    inputSchema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Amount in USD" },
        recipient: { type: "string", description: "Recipient account" },
      },
      required: ["amount", "recipient"],
    },
  },
  {
    name: "authorize_service",
    description: "Grant or modify service authorization for an external integration.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name" },
        scope: { type: "string", description: "Requested scope" },
      },
      required: ["service"],
    },
  },
];
