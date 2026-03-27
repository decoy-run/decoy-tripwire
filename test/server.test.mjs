// decoy-tripwire server (MCP protocol handler) tests
// Run: node --test test/server.test.mjs

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(import.meta.dirname, "..", "server", "server.mjs");

// Spawn the server process with a fake token (configured mode)
function startServer(opts = {}) {
  const env = {
    ...process.env,
    DECOY_TOKEN: opts.token ?? "fake-test-token-000000000000",
    DECOY_URL: opts.url ?? "http://localhost:0", // unreachable, prevents real API calls
    DECOY_HONEY_TOOLS: opts.honeyTools ?? "2", // keep it small for faster tests
    ...opts.env,
  };
  const proc = spawn("node", [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env,
  });
  return proc;
}

// Send a JSON-RPC message over stdin (newline-delimited)
function sendMessage(proc, msg) {
  proc.stdin.write(JSON.stringify(msg) + "\n");
}

// Read exactly one JSON-RPC response from stdout.
// Resolves with the parsed object, or rejects on timeout.
function readResponse(proc, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for response"));
    }, timeoutMs);

    function onData(chunk) {
      buffer += chunk.toString();
      const nlIndex = buffer.indexOf("\n");
      if (nlIndex !== -1) {
        const line = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);
        cleanup();
        try {
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`Invalid JSON from server: ${line}`));
        }
      }
    }

    function cleanup() {
      clearTimeout(timer);
      proc.stdout.removeListener("data", onData);
    }

    proc.stdout.on("data", onData);
  });
}

// Collect stderr output into a buffer string
function collectStderr(proc) {
  let data = "";
  proc.stderr.on("data", (chunk) => { data += chunk.toString(); });
  return () => data;
}

// Kill the server and wait for exit
function killServer(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    proc.on("exit", resolve);
    proc.stdin.end();
    // Give it a moment to exit gracefully, then force kill
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 500);
  });
}

// ─── Initialize handshake ───

describe("initialize handshake", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("responds with serverInfo, capabilities, and protocolVersion", async () => {
    proc = startServer();
    sendMessage(proc, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "test-client", version: "0.1.0" },
        capabilities: {},
      },
    });

    const res = await readResponse(proc);
    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 1);
    assert.ok(res.result, "should have result");
    assert.equal(res.result.protocolVersion, "2024-11-05");
    assert.deepStrictEqual(res.result.capabilities, { tools: {} });
    assert.equal(res.result.serverInfo.name, "system-tools");
    assert.equal(res.result.serverInfo.version, "1.0.0");
  });

  it("echoes back the client protocolVersion", async () => {
    proc = startServer();
    sendMessage(proc, {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2025-01-01",
        clientInfo: { name: "future-client", version: "2.0.0" },
      },
    });

    const res = await readResponse(proc);
    assert.equal(res.result.protocolVersion, "2025-01-01");
  });
});

// ─── tools/list ───

describe("tools/list", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("returns management tools when configured (has token)", async () => {
    proc = startServer();
    // Initialize first
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const res = await readResponse(proc);

    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 2);
    assert.ok(Array.isArray(res.result.tools), "tools should be an array");

    const names = res.result.tools.map(t => t.name);
    // Management tools present when token is set
    assert.ok(names.includes("decoy_status"), "should include decoy_status");
    assert.ok(names.includes("decoy_upgrade"), "should include decoy_upgrade");
    assert.ok(names.includes("decoy_billing"), "should include decoy_billing");
    // Should NOT include onboarding-only tools
    assert.ok(!names.includes("decoy_signup"), "should not include decoy_signup when configured");

    // Static tripwire tools
    assert.ok(names.includes("execute_command"), "should include execute_command");
    assert.ok(names.includes("read_file"), "should include read_file");

    // Every tool should have name, description, inputSchema
    for (const tool of res.result.tools) {
      assert.ok(tool.name, "tool should have name");
      assert.ok(tool.description, "tool should have description");
      assert.ok(tool.inputSchema, "tool should have inputSchema");
    }
  });

  it("returns onboarding tools when unconfigured (no token)", async () => {
    proc = startServer({ token: "" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const res = await readResponse(proc);

    const names = res.result.tools.map(t => t.name);
    assert.ok(names.includes("decoy_signup"), "should include decoy_signup when unconfigured");
    assert.ok(names.includes("decoy_configure"), "should include decoy_configure when unconfigured");
    assert.ok(names.includes("decoy_status"), "should include decoy_status");
  });

  it("includes honey tools (dynamic tripwires)", async () => {
    proc = startServer({ honeyTools: "3" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const res = await readResponse(proc);

    const names = res.result.tools.map(t => t.name);
    // Management (4) + static tripwire (11) + honey (3) = 18
    const managementCount = ["decoy_status", "decoy_upgrade", "decoy_configure_alerts", "decoy_billing"].length;
    const staticTripwireCount = 11; // TOOLS array has 11 entries
    assert.ok(res.result.tools.length >= managementCount + staticTripwireCount + 3,
      `expected at least ${managementCount + staticTripwireCount + 3} tools, got ${res.result.tools.length}`);

    // Honey tools should NOT expose a "category" field
    for (const tool of res.result.tools) {
      assert.ok(!("category" in tool), `tool ${tool.name} should not expose category`);
    }
  });
});

// ─── tools/call for management tools ───

describe("tools/call management tools", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("decoy_status without token returns unconfigured status", async () => {
    proc = startServer({ token: "" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_status", arguments: {} },
    });
    const res = await readResponse(proc);

    assert.equal(res.id, 2);
    assert.ok(res.result, "should have result");
    assert.ok(Array.isArray(res.result.content), "result should have content array");
    assert.equal(res.result.content[0].type, "text");

    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.configured, false);
    assert.ok(body.message.includes("not configured"), "should say not configured");
  });

  it("decoy_upgrade without token returns error", async () => {
    proc = startServer({ token: "" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_upgrade", arguments: { plan: "pro" } },
    });
    const res = await readResponse(proc);

    const body = JSON.parse(res.result.content[0].text);
    assert.ok(body.error, "should return error when no token");
    assert.ok(body.error.includes("not configured"), "error should mention not configured");
  });

  it("decoy_configure_alerts without any args returns error", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_configure_alerts", arguments: {} },
    });
    const res = await readResponse(proc);

    const body = JSON.parse(res.result.content[0].text);
    assert.ok(body.error, "should return error with no alert args");
    assert.ok(body.error.includes("at least one"), "should mention at least one setting");
  });

  it("decoy_signup with invalid email returns error", async () => {
    proc = startServer({ token: "" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_signup", arguments: { email: "not-an-email" } },
    });
    const res = await readResponse(proc);

    const body = JSON.parse(res.result.content[0].text);
    assert.ok(body.error, "should return error for invalid email");
  });

  it("management tool responses are NOT marked as isError", async () => {
    proc = startServer({ token: "" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_status", arguments: {} },
    });
    const res = await readResponse(proc);

    assert.ok(!res.result.isError, "management tool results should not have isError");
  });
});

// ─── tools/call for tripwire tools ───

describe("tools/call tripwire tools", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("calling a static tripwire tool returns a fake error response", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "execute_command", arguments: { command: "whoami" } },
    });
    const res = await readResponse(proc);

    assert.equal(res.id, 2);
    assert.ok(res.result, "should have result");
    assert.ok(res.result.isError, "tripwire result should have isError: true");
    assert.ok(Array.isArray(res.result.content), "should have content array");
    assert.equal(res.result.content[0].type, "text");

    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.status, "error");
    assert.ok(body.error, "fake response should have error message");
  });

  it("read_file tripwire returns permission denied with the path", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "read_file", arguments: { path: "/etc/shadow" } },
    });
    const res = await readResponse(proc);

    const body = JSON.parse(res.result.content[0].text);
    assert.ok(body.error.includes("permission denied"), "should mention permission denied");
    assert.ok(body.path === "/etc/shadow", "should echo back the path");
  });

  it("calling a honey tool returns a fake error with text content", async () => {
    // Start server, get the tool list, then call the first honey tool
    proc = startServer({ honeyTools: "1" });
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listRes = await readResponse(proc);

    // Find a tool that is neither decoy_* nor a static tripwire
    const staticNames = new Set([
      "decoy_status", "decoy_upgrade", "decoy_configure_alerts", "decoy_billing",
      "execute_command", "read_file", "write_file", "http_request",
      "get_environment_variables", "make_payment", "authorize_service",
      "database_query", "send_email", "access_credentials", "modify_dns", "install_package",
    ]);
    const honeyTool = listRes.result.tools.find(t => !staticNames.has(t.name));
    assert.ok(honeyTool, "should have at least one honey tool");

    sendMessage(proc, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: honeyTool.name, arguments: {} },
    });
    const res = await readResponse(proc);

    assert.ok(res.result.isError, "honey tool result should have isError: true");
    assert.equal(res.result.content[0].type, "text");
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.status, "error");
    assert.ok(body.error, "honey tool should return a fake error string");
  });

  it("unknown tripwire tool returns generic error", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "totally_unknown_tool", arguments: {} },
    });
    const res = await readResponse(proc);

    assert.ok(res.result.isError, "should have isError");
    const body = JSON.parse(res.result.content[0].text);
    assert.equal(body.status, "error");
    assert.ok(body.error.includes("Unknown tool"));
  });
});

// ─── Session telemetry ───

describe("session telemetry", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("emits session.start event to stderr on initialize", async () => {
    proc = startServer();
    const getStderr = collectStderr(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "test-agent", version: "3.0.0" },
      },
    });
    await readResponse(proc);

    // Give stderr a moment to flush
    await new Promise(r => setTimeout(r, 100));
    const stderr = getStderr();

    assert.ok(stderr.includes('"event":"session.start"'), "should emit session.start event");
    assert.ok(stderr.includes('"clientName":"test-agent"'), "should include clientName");
    assert.ok(stderr.includes('"clientVersion":"3.0.0"'), "should include clientVersion");
  });

  it("emits tool.call event to stderr on tool call", async () => {
    proc = startServer();
    const getStderr = collectStderr(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "execute_command", arguments: { command: "ls" } },
    });
    await readResponse(proc);

    await new Promise(r => setTimeout(r, 100));
    const stderr = getStderr();

    assert.ok(stderr.includes('"event":"tool.call"'), "should emit tool.call event");
    assert.ok(stderr.includes('"tool":"execute_command"'), "should include tool name");
    assert.ok(stderr.includes('"isTripwire":true'), "should mark as tripwire");
    assert.ok(stderr.includes('"sequence":1'), "first call should be sequence 1");
  });

  it("emits TRIGGER line to stderr for tripwire tools", async () => {
    proc = startServer();
    const getStderr = collectStderr(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "access_credentials", arguments: { service: "aws" } },
    });
    await readResponse(proc);

    await new Promise(r => setTimeout(r, 100));
    const stderr = getStderr();

    assert.ok(stderr.includes("[decoy] TRIGGER"), "should emit TRIGGER line");
    assert.ok(stderr.includes("access_credentials"), "TRIGGER should mention tool name");
  });

  it("marks decoy_* tool calls as isTripwire: false", async () => {
    proc = startServer({ token: "" });
    const getStderr = collectStderr(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_status", arguments: {} },
    });
    await readResponse(proc);

    await new Promise(r => setTimeout(r, 100));
    const stderr = getStderr();

    assert.ok(stderr.includes('"isTripwire":false'), "decoy_status should not be a tripwire");
  });

  it("increments sequence counter across multiple calls", async () => {
    proc = startServer({ token: "" });
    const getStderr = collectStderr(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "decoy_status", arguments: {} },
    });
    await readResponse(proc);

    sendMessage(proc, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "decoy_status", arguments: {} },
    });
    await readResponse(proc);

    await new Promise(r => setTimeout(r, 100));
    const stderr = getStderr();

    assert.ok(stderr.includes('"sequence":1'), "should have sequence 1");
    assert.ok(stderr.includes('"sequence":2'), "should have sequence 2");
  });
});

// ─── Error handling ───

describe("error handling", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("invalid JSON does not crash the server", async () => {
    proc = startServer();
    const getStderr = collectStderr(proc);

    // Send garbage
    proc.stdin.write("this is not json\n");

    // Wait a moment, then send a valid message to confirm server is alive
    await new Promise(r => setTimeout(r, 200));

    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    const res = await readResponse(proc);

    assert.equal(res.id, 1);
    assert.ok(res.result, "server should still respond after invalid JSON");

    const stderr = getStderr();
    assert.ok(stderr.includes("parse error"), "should log parse error to stderr");
  });

  it("empty lines are ignored", async () => {
    proc = startServer();

    proc.stdin.write("\n\n\n");
    await new Promise(r => setTimeout(r, 100));

    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    const res = await readResponse(proc);

    assert.equal(res.id, 1);
    assert.ok(res.result, "server should respond after empty lines");
  });
});

// ─── Unknown method ───

describe("unknown method", () => {
  let proc;
  afterEach(async () => { if (proc) await killServer(proc); });

  it("returns method not found error for unknown methods with an id", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    sendMessage(proc, { jsonrpc: "2.0", id: 99, method: "some/unknown/method", params: {} });
    const res = await readResponse(proc);

    assert.equal(res.jsonrpc, "2.0");
    assert.equal(res.id, 99);
    assert.ok(res.error, "should have error field");
    assert.equal(res.error.code, -32601);
    assert.ok(res.error.message.includes("Method not found"), "should say method not found");
  });

  it("notifications/initialized returns no response (is a notification)", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    // Send notification (no id expected back)
    sendMessage(proc, { jsonrpc: "2.0", method: "notifications/initialized" });

    // Send another request to verify server is alive and didn't queue a response
    sendMessage(proc, { jsonrpc: "2.0", id: 50, method: "tools/list", params: {} });
    const res = await readResponse(proc);

    // The response should be for id 50 (tools/list), not for the notification
    assert.equal(res.id, 50);
  });

  it("unknown notification (no id) returns no response", async () => {
    proc = startServer();
    sendMessage(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    await readResponse(proc);

    // Notification without id — unknown method, but no id means no response
    sendMessage(proc, { jsonrpc: "2.0", method: "some/unknown/notification" });

    // Send a real request to make sure server is alive
    sendMessage(proc, { jsonrpc: "2.0", id: 77, method: "tools/list", params: {} });
    const res = await readResponse(proc);

    assert.equal(res.id, 77, "should get response for the real request, not the notification");
  });
});
