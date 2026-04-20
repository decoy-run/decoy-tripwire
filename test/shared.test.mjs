// Run: node --test test/shared.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFramer, classifySeverity, createSession, shortHash } from "../server/shared.mjs";

describe("createFramer", () => {
  it("parses newline-delimited JSON", () => {
    const f = createFramer();
    const msgs = f.push(Buffer.from(`{"a":1}\n{"b":2}\n`));
    assert.deepEqual(msgs, [{ a: 1 }, { b: 2 }]);
  });

  it("handles split chunks across a message boundary", () => {
    const f = createFramer();
    assert.deepEqual(f.push(Buffer.from(`{"a":`)), []);
    assert.deepEqual(f.push(Buffer.from(`1}\n`)), [{ a: 1 }]);
  });

  it("handles Content-Length framing", () => {
    const f = createFramer();
    const body = `{"hello":"world"}`;
    const framed = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    assert.deepEqual(f.push(Buffer.from(framed)), [{ hello: "world" }]);
  });

  it("handles two Content-Length messages back-to-back", () => {
    const f = createFramer();
    const b1 = `{"id":1}`;
    const b2 = `{"id":2}`;
    const framed = `Content-Length: ${Buffer.byteLength(b1)}\r\n\r\n${b1}Content-Length: ${Buffer.byteLength(b2)}\r\n\r\n${b2}`;
    assert.deepEqual(f.push(Buffer.from(framed)), [{ id: 1 }, { id: 2 }]);
  });

  it("ignores malformed JSON lines", () => {
    const f = createFramer();
    assert.deepEqual(f.push(Buffer.from(`not-json\n{"ok":true}\n`)), [{ ok: true }]);
  });

  it("skips empty newline-only lines", () => {
    const f = createFramer();
    assert.deepEqual(f.push(Buffer.from(`\n\n{"x":1}\n`)), [{ x: 1 }]);
  });
});

describe("classifySeverity", () => {
  it("classifies critical, high, medium", () => {
    assert.equal(classifySeverity("execute_command"), "critical");
    assert.equal(classifySeverity("read_file"), "high");
    assert.equal(classifySeverity("unknown_tool"), "medium");
  });

  it("honey names override to critical", () => {
    const honey = new Set(["custom_honey"]);
    assert.equal(classifySeverity("custom_honey", honey), "critical");
  });
});

describe("createSession / shortHash", () => {
  it("session has expected shape", () => {
    const s = createSession();
    assert.ok(s.startedAt);
    assert.equal(s.toolCallCount, 0);
    assert.equal(s.agentId, null);
  });

  it("shortHash is deterministic", () => {
    assert.equal(shortHash("abc"), shortHash("abc"));
    assert.notEqual(shortHash("abc"), shortHash("abd"));
    assert.equal(shortHash("abc").length, 16);
  });
});
