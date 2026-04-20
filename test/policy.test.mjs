// Run: node --test test/policy.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPolicyEngine } from "../server/policy.mjs";

function engine(policy, opts = {}) {
  // Bypass network by stubbing no token; seed via snapshot injection.
  const e = createPolicyEngine({ token: "", forceMode: opts.forceMode });
  // Drain the default disk-loaded cache by poking private state through refresh-equivalent.
  // The engine's decide() reads a closure `policy`, so instead we use the public API: call
  // decide against defaults first, then use `refresh` semantics indirectly via forceMode + rules.
  return e;
}

describe("policy.decide", () => {
  it("defaults to allow when no rules or filters are set", () => {
    const e = engine({});
    const d = e.decide({ toolName: "read_file", args: {}, upstreamName: "fs" });
    assert.equal(d.decision, "allow");
    assert.equal(d.reason, "default");
  });

  it("honors forceMode override", () => {
    const e = engine({}, { forceMode: "enforce" });
    const d = e.decide({ toolName: "read_file", args: {}, upstreamName: "fs" });
    assert.equal(d.mode, "enforce");
  });

  it("returns observe mode by default", () => {
    const e = engine({});
    const d = e.decide({ toolName: "anything", args: {}, upstreamName: "x" });
    assert.equal(d.mode, "observe");
  });

  it("decide() is synchronous (returns object, not promise)", () => {
    const e = engine({});
    const d = e.decide({ toolName: "x", args: {}, upstreamName: "y" });
    assert.ok(typeof d === "object" && typeof d.then !== "function");
  });
});
