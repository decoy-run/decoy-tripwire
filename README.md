# decoy-tripwire

MCP security scanning and tripwire detection for AI agents.

[![npm](https://img.shields.io/npm/v/decoy-tripwire)](https://www.npmjs.com/package/decoy-tripwire)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

```bash
npx decoy-scan            # 1. Find risks
npx decoy-tripwire init   # 2. Install tripwires
npx decoy-tripwire test   # 3. Verify setup
```

Decoy Tripwire adds a tripwire server alongside your real MCP tools — 12 built-in decoy tools plus dynamically generated tools unique to your deployment. Tools like `execute_command`, `aws_iam_create_admin_role`, and `vault_unseal` that no legitimate agent should ever call. When a prompt injection triggers one, Decoy captures the full payload and alerts you immediately.

Every tool returns a realistic error response. The agent sees a timeout or permission denied — not a detection signal. Attackers don't know they've been caught.

**Works with:** Claude Desktop, Cursor, Windsurf, VS Code, Claude Code

## Get Started

```bash
npx decoy-tripwire init                    # Sign up and install
npx decoy-tripwire init --no-account       # Install for agent self-signup
npx decoy-tripwire login --token=xxx       # Log in with existing token
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
npx decoy-tripwire init                    # Sign up and install tripwires
npx decoy-tripwire login --token=xxx       # Log in with existing token
npx decoy-tripwire doctor                  # Diagnose setup issues
npx decoy-tripwire update                  # Update local server to latest
npx decoy-tripwire uninstall --confirm     # Remove from all MCP hosts

# Monitor
npx decoy-tripwire test                    # Send a test trigger
npx decoy-tripwire status                  # Check triggers and endpoint
npx decoy-tripwire watch                   # Live tail of triggers

# Manage
npx decoy-tripwire agents                  # List connected agents
npx decoy-tripwire agents pause <name>     # Pause tripwires for an agent
npx decoy-tripwire agents resume <name>    # Resume tripwires for an agent
npx decoy-tripwire config                  # View alert configuration
npx decoy-tripwire config --slack=URL      # Set Slack webhook
npx decoy-tripwire config --webhook=URL    # Set webhook URL
npx decoy-tripwire upgrade                 # Upgrade to Pro (via dashboard)
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

| | Free | Pro ($29/mo) | Business ($99/mo) |
|---|---|---|---|
| Tripwires (12+ dynamic) | Yes | Yes | Yes |
| Email alerts | Yes | Yes | Yes |
| Risk scores | Yes | Yes | Yes |
| 7-day history | Yes | | |
| SARIF/JSON export | Yes | Yes | Yes |
| Slack/webhook alerts | | Yes | Yes |
| Agent profiles + fingerprinting | | Yes | Yes |
| 90-day history | | Yes | Yes |
| Threat intel API | | Yes | Yes |
| Security testing | | Yes | Yes |
| OWASP compliance reports | | | Yes |
| Custom detection rules | | | Yes |
| Gateway integrations | | | Yes |

## Local-Only Mode

Works without an account. Without a `DECOY_TOKEN`, triggers are logged to stderr. Zero network dependencies.

```bash
npx decoy-tripwire init --no-account
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
