import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolate via DECOY_HOME so tests don't touch the real ~/.decoy.
let TMP;
let registry;

describe("pauseRegistry", () => {
  before(async () => {
    TMP = mkdtempSync(join(tmpdir(), "decoy-reg-"));
    process.env.DECOY_HOME = TMP;
    registry = await import("../server/pauseRegistry.mjs");
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
    delete process.env.DECOY_HOME;
  });

  it("returns null when no pause is set", () => {
    registry.resumeAll();
    assert.strictEqual(registry.getPause("agent-a"), null);
  });

  it("pause then getPause returns the entry", () => {
    registry.resumeAll();
    registry.pause("agent-a", { ttlMs: 60_000, reason: "tripwire", tool: "make_payment" });
    const got = registry.getPause("agent-a");
    assert.ok(got);
    assert.strictEqual(got.reason, "tripwire");
    assert.strictEqual(got.tool, "make_payment");
    assert.strictEqual(got.scope, "agent");
  });

  it("expired entries are not returned", () => {
    registry.resumeAll();
    registry.pause("agent-a", { ttlMs: 1 });
    const future = Date.now() + 1000;
    assert.strictEqual(registry.getPause("agent-a", future), null);
  });

  it("resume removes the entry", () => {
    registry.resumeAll();
    registry.pause("agent-a", { ttlMs: 60_000 });
    assert.ok(registry.getPause("agent-a"));
    const had = registry.resume("agent-a");
    assert.strictEqual(had, true);
    assert.strictEqual(registry.getPause("agent-a"), null);
  });

  it("resume returns false when agent wasn't paused", () => {
    registry.resumeAll();
    assert.strictEqual(registry.resume("agent-x"), false);
  });

  it("lock makes a pause permanent (expiresAt=null)", () => {
    registry.resumeAll();
    registry.pause("agent-a", { ttlMs: 60_000 });
    const entry = registry.lock("agent-a");
    assert.strictEqual(entry.expiresAt, null);
    assert.ok(registry.getPause("agent-a", Date.now() + 10 * 365 * 24 * 3600_000));
  });

  it("lock on an un-paused agent creates a locked entry", () => {
    registry.resumeAll();
    registry.lock("agent-new", { reason: "manual" });
    const got = registry.getPause("agent-new");
    assert.ok(got);
    assert.strictEqual(got.expiresAt, null);
  });

  it("lockdown ALL_AGENTS wildcard blocks any agent lookup", () => {
    registry.resumeAll();
    registry.pause(registry.ALL_AGENTS, { ttlMs: 60_000, reason: "lockdown" });
    const a = registry.getPause("some-agent");
    const b = registry.getPause("other-agent");
    assert.ok(a);
    assert.ok(b);
    assert.strictEqual(a.scope, "all");
    assert.strictEqual(b.scope, "all");
  });

  it("specific agent pause doesn't affect others", () => {
    registry.resumeAll();
    registry.pause("agent-a", { ttlMs: 60_000 });
    assert.ok(registry.getPause("agent-a"));
    assert.strictEqual(registry.getPause("agent-b"), null);
  });

  it("list returns active pauses only", async () => {
    registry.resumeAll();
    registry.pause("agent-a", { ttlMs: 60_000 });
    registry.pause("agent-b", { ttlMs: 1 });
    await new Promise(r => setTimeout(r, 20));
    const active = registry.list();
    assert.ok(active["agent-a"]);
    assert.ok(!active["agent-b"]);
  });

  it("resumeAll clears everything", () => {
    registry.pause("agent-a", { ttlMs: 60_000 });
    registry.pause(registry.ALL_AGENTS, { ttlMs: 60_000 });
    registry.resumeAll();
    assert.strictEqual(registry.getPause("agent-a"), null);
    assert.strictEqual(registry.getPause("anyone"), null);
  });
});
