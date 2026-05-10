// Tool argument redaction for telemetry.
//
// Tripwire tool arguments are user data — file paths, queries, secrets passing
// through the agent. We need the structural signal (which tool, what shape of
// arguments, how big the values are) without ever putting raw values on our
// side. Future-defensible: we want to be able to truthfully tell a Business
// buyer "we have never collected raw tool arguments."
//
// Strategy:
//   - Replace primitives with their type and length (`<string:42>`, `<number>`).
//   - Recurse into objects/arrays up to MAX_DEPTH (then collapse to `<object:N>`).
//   - For block decisions on critical/high severity, also emit a sha256 prefix
//     of the canonical-stringified arguments. Lets us correlate the same
//     payload across installs (e.g., the same exploit hitting many users)
//     without storing the payload itself.

import { createHash } from "node:crypto";

const MAX_DEPTH = 4;
const MAX_KEYS_PRESERVED = 32;

export function redactValue(v, depth = 0) {
  if (v === null) return "<null>";
  if (v === undefined) return "<undefined>";
  const t = typeof v;
  if (t === "string") return `<string:${v.length}>`;
  if (t === "number") return Number.isInteger(v) ? "<int>" : "<number>";
  if (t === "boolean") return "<boolean>";
  if (t === "bigint") return "<bigint>";
  if (Array.isArray(v)) {
    if (depth >= MAX_DEPTH) return `<array:${v.length}>`;
    return v.slice(0, MAX_KEYS_PRESERVED).map(item => redactValue(item, depth + 1));
  }
  if (t === "object") {
    if (depth >= MAX_DEPTH) {
      return `<object:${Object.keys(v).length} keys>`;
    }
    const out = {};
    const keys = Object.keys(v).slice(0, MAX_KEYS_PRESERVED);
    for (const k of keys) {
      out[k] = redactValue(v[k], depth + 1);
    }
    if (Object.keys(v).length > keys.length) {
      out.__truncated__ = `<+${Object.keys(v).length - keys.length} keys>`;
    }
    return out;
  }
  return `<${t}>`;
}

export function redactArguments(args) {
  if (args === null || args === undefined) return null;
  return redactValue(args);
}

// Stable JSON for hashing — sorted keys so structurally-identical payloads
// produce the same fingerprint across runs.
function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

export function fingerprint(args, len = 16) {
  if (args === null || args === undefined) return null;
  try {
    return createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, len);
  } catch {
    return null;
  }
}

// Should we attach a fingerprint to a given decision? Only for confirmed-malicious
// (block + critical/high) — that's where cross-install correlation has signal.
export function shouldFingerprint({ decision, severity }) {
  return decision === "block" && (severity === "critical" || severity === "high");
}
