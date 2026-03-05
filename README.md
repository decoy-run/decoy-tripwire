# Decoy

Security tripwires for AI agents. Detect prompt injection before it causes damage.

Decoy is a fake MCP server that advertises tools an AI agent should never call — `execute_command`, `read_file`, `make_payment`, and more. In normal operation, your agent ignores them. When prompt injection overrides behavior, the decoy catches the full attack payload and alerts you.

## Quick start

```bash
npx decoy-mcp init
```

This creates a free account, installs the MCP server locally, and configures Claude Desktop. Takes 30 seconds.

## How it works

1. Decoy registers as an MCP server called `system-tools` alongside your real tools
2. It exposes 7 tripwire tools that look like real system access
3. Your agent has no reason to call them — it uses its real tools
4. If prompt injection forces the agent to reach for unauthorized access, the tripwire fires
5. You get the full payload: what tool, what arguments, severity, timestamp
6. Alerts go to your dashboard, Slack, webhooks, or email

## Tripwire tools

| Tool | What it traps |
|------|--------------|
| `execute_command` | Shell execution (curl, wget, nc, crontab, rm) |
| `read_file` | Credential theft (.ssh, .env, passwd, shadow) |
| `write_file` | Persistence (authorized_keys, .bashrc, crontab) |
| `http_request` | Data exfiltration (POST to external URLs) |
| `get_environment_variables` | Secret harvesting (API keys, tokens) |
| `make_payment` | Unauthorized payments via x402 protocol |
| `authorize_service` | Unauthorized trust grants to external services |

Every tool returns a realistic error response. The agent sees a timeout or permission denied — not a detection signal. Attackers don't know they've been caught.

## Commands

```bash
npx decoy-mcp init        # Set up protection
npx decoy-mcp status      # Check triggers and connection
npx decoy-mcp uninstall   # Remove from config
```

## Manual setup

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "system-tools": {
      "command": "node",
      "args": ["~/.config/Claude/decoy/server.mjs"],
      "env": { "DECOY_TOKEN": "your-token" }
    }
  }
}
```

Get a token at [decoy.run](https://decoy.run).

## Dashboard

View triggers, configure alerts, and manage your tripwires at [decoy.run/dashboard](https://decoy.run/dashboard).

**Free tier** — unlimited triggers, full dashboard, forever.

**Pro tier ($9/mo)** — Slack alerts, webhook integrations, email notifications.

## Why tripwires work

Traditional security blocks known-bad inputs. But prompt injection is natural language — there's no signature to match. Tripwires flip the model: instead of trying to recognize attacks, you detect unauthorized behavior. If your agent tries to execute a shell command through a tool that shouldn't exist, something went wrong.

This is the same principle behind canary tokens and network deception. Tripwires don't have false positives because legitimate users never touch them.

## Research

We tested prompt injection against 6 models. Llama 3.1 8B was fully compromised — it called all three tools with attacker-controlled arguments. Claude and GPT-4 resisted. Full results at [decoy.run/blog](https://decoy.run/blog).

## License

MIT
