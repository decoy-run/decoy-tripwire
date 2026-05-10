// Tests for redact.mjs — the privacy boundary for tripwire telemetry.
// If these tests pass we can truthfully say "raw tool arguments never left
// the client." If they fail, the privacy posture is broken.
//
// Run: node --test test/redact.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactArguments, redactValue, fingerprint, shouldFingerprint } from "../server/redact.mjs";

describe("redactValue: primitives", () => {
  it("strings are replaced by <string:N>", () => {
    assert.equal(redactValue("hello world"), "<string:11>");
    assert.equal(redactValue(""), "<string:0>");
  });

  it("integers and floats are tagged distinctly", () => {
    assert.equal(redactValue(42), "<int>");
    assert.equal(redactValue(3.14), "<number>");
  });

  it("boolean / null / undefined are tagged", () => {
    assert.equal(redactValue(true), "<boolean>");
    assert.equal(redactValue(false), "<boolean>");
    assert.equal(redactValue(null), "<null>");
    assert.equal(redactValue(undefined), "<undefined>");
  });
});

describe("redactValue: objects and arrays", () => {
  it("objects keep keys, redact values", () => {
    const r = redactValue({ path: "/Users/foo/bar.txt", count: 3 });
    assert.deepEqual(r, { path: "<string:18>", count: "<int>" });
  });

  it("arrays redact items", () => {
    const r = redactValue([ "a", "bb", 1 ]);
    assert.deepEqual(r, [ "<string:1>", "<string:2>", "<int>" ]);
  });

  it("deeply-nested objects collapse beyond MAX_DEPTH without leaking values", () => {
    const deep = { a: { b: { c: { d: { e: { f: "secret" } } } } } };
    const r = redactValue(deep);
    // Walk in: a.b.c are expanded; d collapses to "<object:N keys>".
    assert.equal(typeof r.a, "object");
    assert.equal(typeof r.a.b, "object");
    assert.equal(typeof r.a.b.c, "object");
    // Past MAX_DEPTH=4 the inner objects become a "<object:N keys>" string.
    assert.match(JSON.stringify(r), /<object:\d+ keys>/);
    // CRITICAL: the literal string "secret" must never appear anywhere.
    assert.ok(!JSON.stringify(r).includes("secret"));
  });

  it("very wide objects truncate keys past MAX_KEYS_PRESERVED", () => {
    const wide = {};
    for (let i = 0; i < 50; i++) wide[`k${i}`] = `value${i}`;
    const r = redactValue(wide);
    assert.ok(r.__truncated__, "should mark truncation");
    assert.match(r.__truncated__, /<\+\d+ keys>/);
  });
});

describe("redactValue: privacy invariants", () => {
  it("never includes raw string content for any input shape", () => {
    const inputs = [
      { secret: "sk_live_ABC123" },
      ["password", "hunter2"],
      { nested: { token: "Bearer xyz" } },
      "/Users/john/Documents/file.txt",
      "?api_key=ABCDEF&q=user@example.com",
      { args: [{ body: "POST /admin\nAuthorization: token" }] },
    ];
    for (const input of inputs) {
      const r = JSON.stringify(redactValue(input));
      // The redacted output must never contain any non-trivial substring
      // from the original strings. "secret" in keys is fine; values are not.
      assert.ok(!r.includes("sk_live"), "secret value leaked");
      assert.ok(!r.includes("hunter2"), "password value leaked");
      assert.ok(!r.includes("Bearer xyz"), "auth header value leaked");
      assert.ok(!r.includes("john"), "filename leaked");
      assert.ok(!r.includes("ABCDEF"), "API key leaked");
      assert.ok(!r.includes("user@example.com"), "email leaked");
      assert.ok(!r.includes("Authorization: token"), "header content leaked");
    }
  });

  it("preserves keys (which are typically not user data) but never values", () => {
    const r = redactValue({ filepath: "/etc/passwd", apiKey: "sk_xxx" });
    assert.ok("filepath" in r);
    assert.ok("apiKey" in r);
    assert.ok(!JSON.stringify(r).includes("/etc/passwd"));
    assert.ok(!JSON.stringify(r).includes("sk_xxx"));
  });
});

describe("redactArguments", () => {
  it("returns null for null/undefined input", () => {
    assert.equal(redactArguments(null), null);
    assert.equal(redactArguments(undefined), null);
  });

  it("handles typical tool argument shapes", () => {
    const args = { path: "/secret/file", recursive: true };
    const r = redactArguments(args);
    assert.deepEqual(r, { path: "<string:12>", recursive: "<boolean>" });
  });
});

describe("fingerprint", () => {
  it("returns a stable hex prefix for identical args (key-order-independent)", () => {
    const a = { path: "/etc/passwd", mode: "read" };
    const b = { mode: "read", path: "/etc/passwd" };
    assert.equal(fingerprint(a), fingerprint(b));
    assert.match(fingerprint(a), /^[0-9a-f]{16}$/);
  });

  it("different args produce different fingerprints", () => {
    const a = { x: 1 };
    const b = { x: 2 };
    assert.notEqual(fingerprint(a), fingerprint(b));
  });

  it("returns null for null/undefined", () => {
    assert.equal(fingerprint(null), null);
    assert.equal(fingerprint(undefined), null);
  });
});

describe("shouldFingerprint", () => {
  it("returns true only for block + critical/high", () => {
    assert.equal(shouldFingerprint({ decision: "block", severity: "critical" }), true);
    assert.equal(shouldFingerprint({ decision: "block", severity: "high" }), true);
    assert.equal(shouldFingerprint({ decision: "block", severity: "medium" }), false);
    assert.equal(shouldFingerprint({ decision: "allow", severity: "critical" }), false);
    assert.equal(shouldFingerprint({ decision: "query", severity: "critical" }), false);
  });
});
