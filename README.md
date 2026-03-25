# decoy-mcp

Know when your agents are compromised. Tripwire detection for AI agents.

[![npm](https://img.shields.io/npm/v/decoy-mcp)](https://www.npmjs.com/package/decoy-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npx decoy-scan        # 1. Find risks
npx decoy-mcp init    # 2. Install tripwires
npx decoy-mcp test    # 3. Verify setup
```

Decoy MCP adds a tripwire server alongside your real MCP tools — 12 built-in decoy tools plus dynamically generated tools unique to your deployment. Tools like `execute_command`, `aws_iam_create_admin_role`, and `vault_unseal` that no legitimate agent should ever call. When a prompt injection attack tricks your agent into calling one, Decoy captures the full payload and alerts you instantly.

Every tool returns a realistic error response. The agent sees a timeout or permission denied — not a detection signal. Attackers don't know they've been caught.

**Works with:** Claude Desktop, Cursor, Windsurf, VS Code, Claude Code

## Get Started

```bash
npx decoy-mcp init                    # Sign up and install
npx decoy-mcp init --no-account       # Install for agent self-signup
npx decoy-mcp login --token=xxx       # Log in with existing token
```

## Tripwire Tools

| Tool | What it traps | Severity |
|------|--------------|----------|
| `execute_command` | Shell execution | Critical |
| `write_file` | File system persistence | Critical |
| `make_payment` | Unauthorized payments | Critical |
| `authorize_service` | Trust grants to external services | Critical |
| `modify_dns` | DNS record hijacking | Critical |
| `read_file` | Credential theft | High |
| `http_request` | Data exfiltration | High |
| `database_query` | SQL execution | High |
| `access_credentials` | API key theft | High |
| `send_email` | Phishing via agent | High |
| `install_package` | Supply chain attack | High |
| `get_environment_variables` | Secret harvesting | High |

Plus dynamically generated tools from 6 threat categories (cloud infrastructure, secrets management, payments, CI/CD, identity, network). Each deployment gets a unique, deterministic set.

## Commands

```bash
# Setup
npx decoy-mcp init                    # Sign up and install tripwires
npx decoy-mcp login --token=xxx       # Log in with existing token
npx decoy-mcp doctor                  # Diagnose setup issues
npx decoy-mcp update                  # Update local server to latest
npx decoy-mcp uninstall --confirm     # Remove from all MCP hosts

# Monitor
npx decoy-mcp test                    # Send a test trigger
npx decoy-mcp status                  # Check triggers and endpoint
npx decoy-mcp watch                   # Live tail of triggers

# Manage
npx decoy-mcp agents                  # List connected agents
npx decoy-mcp agents pause <name>     # Pause tripwires for an agent
npx decoy-mcp agents resume <name>    # Resume tripwires for an agent
npx decoy-mcp config                  # View alert configuration
npx decoy-mcp config --slack=URL      # Set Slack webhook
npx decoy-mcp config --webhook=URL    # Set webhook URL
npx decoy-mcp upgrade                 # Upgrade to Pro (via dashboard)
```

All commands support `--json` for machine-readable output and `--token=xxx` to specify a token.

## Scanning

Scanning moved to [decoy-scan](https://npmjs.com/package/decoy-scan):

```bash
npx decoy-scan                        # Scan all MCP servers
npx decoy-scan --policy=no-critical   # CI/CD policy gate
```

## Dashboard

Your dashboard is at [app.decoy.run/dashboard](https://app.decoy.run/dashboard). Features:

- **Incident timeline** — full attack detail with "Blocked" status, attack patterns, and recommended actions
- **Agent management** — fingerprinting, risk scores, pause/resume, behavioral anomaly detection
- **Rich alerts** — Slack Block Kit, webhooks, email with full incident context
- **Threat intelligence** — CVE monitoring, attack pattern corpus, MCP advisories
- **Compliance reports** — OWASP Agentic Top 10 assessment with trigger history and agent inventory

## Plans

| | Free | Pro ($99/mo) | Business ($299/mo) |
|---|---|---|---|
| Tripwires (12+ dynamic) | Yes | Yes | Yes |
| Alerts (email/Slack/webhook) | Yes | Yes | Yes |
| Agent fingerprinting + risk scores | Yes | Yes | Yes |
| 90-day history | Yes | Yes | Yes |
| SARIF/JSON export | Yes | Yes | Yes |
| Threat intel API | | Yes | Yes |
| Security testing | | Yes | Yes |
| Weekly digest | | Yes | Yes |
| OWASP compliance reports | | | Yes |
| Custom detection rules | | | Yes |
| Gateway integrations | | | Yes |

## Local-Only Mode

Works without an account. Without a `DECOY_TOKEN`, triggers are logged to stderr. Zero network dependencies.

```bash
npx decoy-mcp init --no-account
# Triggers logged locally: [decoy] TRIGGER CRITICAL execute_command {...}
```

## Why Tripwires

Traditional security blocks known-bad inputs. But prompt injection is natural language — there's no signature to match. Tripwires detect unauthorized behavior instead. If your agent reaches for `execute_command` through a tool that shouldn't exist, something went wrong. Same principle as canary tokens and network deception.

## Related

- [decoy-scan](https://npmjs.com/package/decoy-scan) — Find security risks in your MCP servers
- [Decoy Guard](https://decoy.run) — Dashboard, threat intel, compliance reports
- [OWASP Agentic Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)

## License

MIT
