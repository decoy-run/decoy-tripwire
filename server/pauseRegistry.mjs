// Cross-process pause registry at ~/.decoy/pause.json.
//
// When a tripwire fires in any proxy instance, that process writes a pause
// entry here. Every other proxy instance reads this file on its hot path
// (tools/call) and denies if the agent is paused. Sub-ms — the file is small
// and stays in the OS page cache.
//
// Entries have a TTL so false positives auto-recover. Locked entries
// (expiresAt = null) stay until explicitly resumed.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// DECOY_HOME env var overrides the registry location. Tests use it to avoid
// clobbering the real ~/.decoy while the proxy subprocess runs.
const DIR = process.env.DECOY_HOME || join(homedir(), ".decoy");
const FILE = join(DIR, "pause.json");

// Wildcard agent ID — lockdown mode pauses every agent at once.
export const ALL_AGENTS = "*";

function load() {
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { agents: {} };
  } catch {
    return { agents: {} };
  }
}

function save(state) {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, FILE);
}

function isActive(entry, now = Date.now()) {
  if (!entry) return false;
  if (entry.expiresAt === null) return true;
  return new Date(entry.expiresAt).getTime() > now;
}

// Prune expired entries. Returns the cleaned state.
function prune(state, now = Date.now()) {
  const agents = {};
  for (const [id, entry] of Object.entries(state.agents || {})) {
    if (isActive(entry, now)) agents[id] = entry;
  }
  return { agents };
}

// Returns the active pause entry for an agent, or null. An ALL_AGENTS entry
// (lockdown mode) wins over a specific agent's absence — one global pause
// blocks all.
export function getPause(agentId, now = Date.now()) {
  const state = load();
  const global = state.agents?.[ALL_AGENTS];
  if (isActive(global, now)) return { ...global, scope: "all" };
  const entry = state.agents?.[agentId];
  if (isActive(entry, now)) return { ...entry, scope: "agent" };
  return null;
}

// Write or overwrite a pause entry.
//   agentId: the fingerprint, or ALL_AGENTS for a lockdown-wide pause
//   ttlMs: null = locked (never expires); number = auto-expire
//   reason: human-readable string
//   tool: the tripwire tool that caused this pause (for status display)
export function pause(agentId, { ttlMs = 10 * 60 * 1000, reason = "tripwire", tool = null } = {}) {
  const state = prune(load());
  state.agents[agentId] = {
    pausedAt: new Date().toISOString(),
    expiresAt: ttlMs === null ? null : new Date(Date.now() + ttlMs).toISOString(),
    reason,
    tool,
  };
  save(state);
  return state.agents[agentId];
}

// Remove one agent (or ALL_AGENTS) from the registry.
export function resume(agentId) {
  const state = prune(load());
  const had = !!state.agents[agentId];
  delete state.agents[agentId];
  save(state);
  return had;
}

// Remove every entry.
export function resumeAll() {
  save({ agents: {} });
}

// Upgrade an existing pause to locked (no TTL). If nothing paused, create a
// locked entry so `lock` is idempotent.
export function lock(agentId, { reason = "manual-lock", tool = null } = {}) {
  const state = prune(load());
  const existing = state.agents[agentId];
  state.agents[agentId] = {
    pausedAt: existing?.pausedAt || new Date().toISOString(),
    expiresAt: null,
    reason: existing?.reason || reason,
    tool: existing?.tool || tool,
  };
  save(state);
  return state.agents[agentId];
}

// Snapshot of active pauses (prunes expired as a side effect).
export function list() {
  const state = prune(load());
  save(state);
  return state.agents;
}

// Test seam.
export const _paths = { DIR, FILE };
