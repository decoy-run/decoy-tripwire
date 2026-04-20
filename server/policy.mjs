// Local policy engine for the proxy. Synchronous decide() on the hot path.
// Policy is fetched from decoy-app out-of-band and cached to disk at ~/.decoy/policy.json.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { DECOY_URL } from "./shared.mjs";

const CACHE_DIR = join(homedir(), ".decoy");
const CACHE_FILE = join(CACHE_DIR, "policy.json");
const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_POLICY = {
  version: "0",
  mode: "observe",
  defaultDecision: "allow",
  agents: {},
  servers: {},
  rules: [],
  fetchedAt: null,
};

export function createPolicyEngine({ url = DECOY_URL, token, refreshMs = DEFAULT_REFRESH_MS, forceMode } = {}) {
  let policy = loadFromDisk() || { ...DEFAULT_POLICY };
  const frequencyCounters = new Map();
  let refreshTimer = null;

  function effectiveMode() {
    if (forceMode) return forceMode;
    return policy.mode || "observe";
  }

  function matchRule(rule, { toolName, args }) {
    if (!rule || rule.enabled === false) return false;
    const cfg = rule.config || {};
    if (rule.type === "tool_name_match") {
      const names = Array.isArray(cfg.tools) ? cfg.tools : [];
      return names.includes(toolName);
    }
    if (rule.type === "argument_match") {
      const pattern = cfg.pattern;
      if (!pattern) return false;
      try {
        const re = new RegExp(pattern, cfg.flags || "");
        return re.test(JSON.stringify(args || {}));
      } catch { return false; }
    }
    if (rule.type === "frequency_threshold") {
      const key = `${rule.ruleId}:${toolName}`;
      const windowMs = (cfg.windowSeconds || 60) * 1000;
      const threshold = cfg.maxCalls || 10;
      const now = Date.now();
      const timestamps = (frequencyCounters.get(key) || []).filter(t => now - t < windowMs);
      timestamps.push(now);
      frequencyCounters.set(key, timestamps);
      return timestamps.length > threshold;
    }
    return false;
  }

  // Synchronous. Safe to call from hot path.
  function decide({ toolName, args, upstreamName, agentId }) {
    const mode = effectiveMode();

    // 1. Paused agent → deny-all
    const agent = agentId ? policy.agents?.[agentId] : null;
    if (agent?.status === "paused") {
      return { decision: "deny", reason: "agent_paused", mode };
    }

    const server = upstreamName ? policy.servers?.[upstreamName] : null;
    const agentFilter = agent?.toolFilter || {};

    // 2. Explicit deny
    if (server?.deny?.includes(toolName)) {
      return { decision: "deny", reason: "server_deny", mode };
    }
    if (agentFilter.deny?.includes(toolName)) {
      return { decision: "deny", reason: "agent_deny", mode };
    }

    // 3. Rule match — rules can deny outright or warn
    for (const rule of policy.rules || []) {
      if (matchRule(rule, { toolName, args })) {
        const severity = rule.config?.severity || "warn";
        const decision = severity === "critical" || severity === "deny" ? "deny" : "warn";
        return { decision, reason: `rule_${rule.type}`, ruleId: rule.ruleId, mode };
      }
    }

    // 4. Explicit allow (agent wins over server)
    if (agentFilter.allow?.length) {
      return agentFilter.allow.includes(toolName)
        ? { decision: "allow", reason: "agent_allow", mode }
        : { decision: "deny", reason: "agent_allow_miss", mode };
    }
    if (server?.allow?.length) {
      return server.allow.includes(toolName)
        ? { decision: "allow", reason: "server_allow", mode }
        : { decision: "deny", reason: "server_allow_miss", mode };
    }

    // 5. Default
    const def = policy.defaultDecision === "deny" ? "deny" : "allow";
    return { decision: def, reason: "default", mode };
  }

  async function refresh() {
    if (!token) return { ok: false, reason: "no_token" };
    try {
      const res = await fetch(`${url}/api/policy`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, reason: `status_${res.status}` };
      const fetched = await res.json();
      policy = { ...DEFAULT_POLICY, ...fetched, fetchedAt: new Date().toISOString() };
      try { saveToDisk(policy); } catch (e) { process.stderr.write(`[decoy-proxy] policy cache write failed: ${e.message}\n`); }
      return { ok: true, version: policy.version };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  function startRefreshLoop() {
    if (refreshTimer) return;
    const tick = () => {
      const jitter = Math.floor(Math.random() * 30_000);
      refreshTimer = setTimeout(async () => {
        await refresh();
        tick();
      }, refreshMs + jitter);
      // Don't block process exit when the loop is the only thing alive.
      refreshTimer.unref?.();
    };
    tick();
  }

  function stop() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  return { decide, refresh, startRefreshLoop, stop, snapshot: () => ({ ...policy, mode: effectiveMode() }) };
}

function loadFromDisk() {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    const raw = readFileSync(CACHE_FILE, "utf8");
    return JSON.parse(raw);
  } catch { return null; }
}

function saveToDisk(policy) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(policy, null, 2));
}

// Exposed for tests.
export const _internals = { loadFromDisk, saveToDisk, CACHE_FILE };
