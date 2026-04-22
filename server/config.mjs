// Local user config at ~/.decoy/config.json.
// Tiny, read on every pause write — file is small, stays cached by the OS.

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// DECOY_HOME env var overrides the config dir — used by tests.
const DIR = process.env.DECOY_HOME || join(homedir(), ".decoy");
const FILE = join(DIR, "config.json");

const DEFAULTS = {
  // When true, a tripwire hit pauses every agent behind this proxy, not just
  // the one that tripped. Named after Apple's Lockdown Mode — maximum
  // defensive posture.
  lockdownMode: false,
  // Default TTL for auto-pauses on tripwire hit (ms). null = locked forever.
  pauseTtlMs: 10 * 60 * 1000,
  // Desktop notifications when a tripwire fires.
  desktopNotifications: true,
};

export function loadConfig() {
  try {
    const raw = readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      // Legacy key: paranoidMode was renamed to lockdownMode. Honor the old
      // value on read so early testers don't lose their setting.
      if ("paranoidMode" in parsed && !("lockdownMode" in parsed)) {
        parsed.lockdownMode = parsed.paranoidMode;
        delete parsed.paranoidMode;
      }
      return { ...DEFAULTS, ...parsed };
    }
    return { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(partial) {
  const merged = { ...loadConfig(), ...partial };
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(merged, null, 2));
  renameSync(tmp, FILE);
  return merged;
}

export const _paths = { DIR, FILE };
