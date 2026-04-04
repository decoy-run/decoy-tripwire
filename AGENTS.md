# AGENTS.md

Guidance for AI agents and human contributors working in this repository.

## 1. What Decoy Is

Decoy is a security tripwire system for AI agent pipelines. It deploys tripwire MCP tools that detect prompt injection attacks in real time. If a malicious prompt tricks an agent into calling a decoy tool, the operator gets alerted instantly.

## 2. Repo Structure

```
decoy-tripwire/
├── server/server.mjs   # MCP server (stdio transport, zero dependencies)
├── bin/cli.mjs          # CLI (npx decoy-tripwire ...)
├── package.json
├── README.md
├── AGENTS.md            # You are here
└── CONTRIBUTING.md
```

This repo is the open-source MCP client. The backend worker and marketing site live in separate repos.

## 3. Architecture

### server.mjs — Dual-Mode MCP Server

The server operates in two modes based on whether `DECOY_TOKEN` is set:

**Unconfigured** (no token): Exposes 3 onboarding tools + 12 tripwire tools
- `decoy_signup`, `decoy_configure`, `decoy_status`
- Tripwire triggers are logged locally only

**Configured** (has token): Exposes 4 management tools + 12 tripwire tools
- `decoy_status`, `decoy_upgrade`, `decoy_configure_alerts`, `decoy_billing`
- Tripwire triggers are reported to `app.decoy.run`

Mode switches at runtime when `decoy_configure` is called — no restart needed.

### cli.mjs — CLI Commands

Handles `init`, `login`, `scan`, `status`, `test`, `watch`, `agents`, `config`, `upgrade`, `doctor`, `update`, `uninstall`. All commands are in a single file with no build step.

### Key Design Decisions

- **Zero dependencies.** server.mjs and cli.mjs use only Node.js builtins. No npm install needed at runtime.
- **Self-contained.** server.mjs includes its own config path detection and writing logic (duplicated from cli.mjs intentionally) so it can operate independently.
- **Realistic errors.** Every tripwire tool returns a plausible error (timeout, permission denied, connection refused). The agent should not be able to distinguish a decoy tool from a broken real tool.
- **Fire and forget.** Trigger reporting is async and non-blocking. A network failure to report a trigger must never break the MCP session.

## 4. Working With This Code

### Making Changes to Tripwire Tools

If you add, remove, or modify a tripwire tool:
1. Update the `TOOLS` array in `server/server.mjs`
2. Add a corresponding entry in `FAKE_RESPONSES`
3. Update `classifySeverity()` if the tool is critical or high severity
4. The backend (`decoy-app/src/tools.js`) has a matching tool list — keep them in sync

### Making Changes to Decoy Tools

The `decoy_*` tools (signup, configure, status, upgrade, configure_alerts, billing) are real — they call Decoy APIs and modify local state. Changes to these tools may require corresponding backend API changes.

### Making Changes to the CLI

Commands are defined as functions and wired in the `switch` statement at the bottom of `cli.mjs`. Follow the existing pattern: accept `flags`, support `--json` for machine output, use the color constants for terminal output.

## 5. Testing

There is no test framework. Verify changes by running the server with stdin/stdout:

```bash
# Unconfigured mode
printf '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":"1"}\n{"jsonrpc":"2.0","method":"tools/list","id":"2"}\n' | DECOY_TOKEN="" node server/server.mjs 2>/dev/null

# Configured mode
printf '...' | DECOY_TOKEN="test-token" node server/server.mjs 2>/dev/null
```

Syntax check before committing:
```bash
node -c server/server.mjs
node -c bin/cli.mjs
```

## 6. API Endpoints

The server proxies to these backend endpoints:

| Decoy Tool | Backend Endpoint |
|------------|-----------------|
| `decoy_signup` | `POST /api/signup` |
| `decoy_configure` | `GET /api/billing?token=` (validation) |
| `decoy_status` | `GET /api/billing?token=` + `GET /api/triggers?token=` |
| `decoy_upgrade` | `POST /api/upgrade` |
| `decoy_configure_alerts` | `PATCH /api/config?token=` |
| `decoy_billing` | `GET /api/billing?token=` |

## 7. Things to Be Careful About

- **Never log tokens to stdout.** Stdout is the MCP transport. Use `process.stderr.write()` for debug output.
- **Never store card numbers.** The `decoy_upgrade` tool passes card details through to Stripe via the backend API. They must never be written to disk or logged.
- **Keep the server zero-dependency.** Don't add npm packages. Use Node.js builtins only.
- **Don't make tripwire tools detectable.** The fake responses should be indistinguishable from real tool failures. No "decoy" or "tripwire" strings in tool descriptions or error messages.
