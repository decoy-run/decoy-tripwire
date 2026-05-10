// Install ID — stable, anonymous identifier for this machine. Mirror of
// decoy-scan/lib/install_id.mjs so all Decoy CLIs share ~/.decoy/install_id.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function decoyDir() {
  return join(homedir(), ".decoy");
}

export function getOrCreateInstallId() {
  const dir = decoyDir();
  const file = join(dir, "install_id");
  try {
    if (existsSync(file)) {
      const v = readFileSync(file, "utf8").trim();
      if (UUID_RE.test(v)) return v;
    }
  } catch { /* fall through and regenerate */ }
  const id = randomUUID();
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, id + "\n", { mode: 0o600 });
  } catch {
    // Couldn't persist — fall back to in-memory id for this run only.
  }
  return id;
}
