#!/usr/bin/env node

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_URL = "https://decoy.run/api/signup";

const ORANGE = "\x1b[38;5;208m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const WHITE = "\x1b[37m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function log(msg) { process.stdout.write(msg + "\n"); }

function getConfigPath() {
  const p = platform();
  const home = homedir();
  if (p === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (p === "win32") return join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function signup(email) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Signup failed (${res.status})`);
  }
  return res.json();
}

function getServerPath() {
  return join(__dirname, "..", "server", "server.mjs");
}

function installServer(token) {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  const serverSrc = getServerPath();

  // Ensure config dir exists
  mkdirSync(configDir, { recursive: true });

  // Install the server file to a stable location
  const installDir = join(configDir, "decoy");
  mkdirSync(installDir, { recursive: true });
  const serverDst = join(installDir, "server.mjs");
  copyFileSync(serverSrc, serverDst);

  // Read or create config
  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      // Backup corrupt config
      const backup = configPath + ".bak." + Date.now();
      copyFileSync(configPath, backup);
      log(`  ${DIM}Backed up existing config to ${backup}${RESET}`);
    }
  }

  // Add MCP server
  if (!config.mcpServers) config.mcpServers = {};

  // Check for existing decoy
  if (config.mcpServers["system-tools"]) {
    const existing = config.mcpServers["system-tools"];
    if (existing.env?.DECOY_TOKEN === token) {
      return { configPath, serverDst, alreadyConfigured: true };
    }
  }

  config.mcpServers["system-tools"] = {
    command: "node",
    args: [serverDst],
    env: { DECOY_TOKEN: token },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return { configPath, serverDst, alreadyConfigured: false };
}

async function init() {
  log("");
  log(`  ${ORANGE}${BOLD}decoy${RESET} ${DIM}— security tripwires for AI agents${RESET}`);
  log("");

  const email = await prompt(`  ${DIM}Email:${RESET} `);
  if (!email || !email.includes("@")) {
    log(`  ${RED}Invalid email${RESET}`);
    process.exit(1);
  }

  // Signup
  let data;
  try {
    data = await signup(email);
  } catch (e) {
    log(`  ${RED}${e.message}${RESET}`);
    process.exit(1);
  }

  if (data.existing) {
    log(`  ${GREEN}\u2713${RESET} Found existing decoy endpoint`);
  } else {
    log(`  ${GREEN}\u2713${RESET} Created decoy endpoint`);
  }

  // Find config
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    log(`  ${GREEN}\u2713${RESET} Found Claude Desktop config`);
  } else {
    log(`  ${GREEN}\u2713${RESET} Will create Claude Desktop config`);
  }

  // Install
  const result = installServer(data.token);

  if (result.alreadyConfigured) {
    log(`  ${GREEN}\u2713${RESET} Already configured`);
  } else {
    log(`  ${GREEN}\u2713${RESET} Added system-tools MCP server`);
    log(`  ${GREEN}\u2713${RESET} Installed local decoy server`);
  }

  log("");
  log(`  ${WHITE}${BOLD}Restart Claude Desktop. You're protected.${RESET}`);
  log("");
  log(`  ${DIM}Dashboard:${RESET} ${ORANGE}${data.dashboardUrl}${RESET}`);
  log(`  ${DIM}Token:${RESET}     ${DIM}${data.token}${RESET}`);
  log("");
}

async function status() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    log(`  ${RED}No Claude Desktop config found${RESET}`);
    log(`  ${DIM}Run: npx decoy-mcp init${RESET}`);
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const server = config.mcpServers?.["system-tools"];
  if (!server) {
    log(`  ${RED}No decoy configured${RESET}`);
    log(`  ${DIM}Run: npx decoy-mcp init${RESET}`);
    process.exit(1);
  }

  const token = server.env?.DECOY_TOKEN;
  if (!token) {
    log(`  ${RED}Decoy configured but no token found${RESET}`);
    process.exit(1);
  }

  log("");
  log(`  ${ORANGE}${BOLD}decoy${RESET} ${DIM}— status${RESET}`);
  log("");

  // Fetch triggers
  try {
    const res = await fetch(`https://decoy.run/api/triggers?token=${token}`);
    const data = await res.json();
    log(`  ${DIM}Token:${RESET}      ${token.slice(0, 8)}...`);
    log(`  ${DIM}Triggers:${RESET}   ${data.count}`);
    if (data.triggers?.length > 0) {
      const latest = data.triggers[0];
      log(`  ${DIM}Latest:${RESET}    ${latest.tool} ${DIM}(${latest.severity})${RESET} — ${latest.timestamp}`);
    }
    log(`  ${DIM}Dashboard:${RESET} ${ORANGE}https://decoy.run/dashboard?token=${token}${RESET}`);
  } catch (e) {
    log(`  ${RED}Failed to fetch status: ${e.message}${RESET}`);
  }
  log("");
}

function uninstall() {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    log(`  ${DIM}No config found — nothing to remove${RESET}`);
    return;
  }

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.mcpServers?.["system-tools"]) {
    delete config.mcpServers["system-tools"];
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    log(`  ${GREEN}\u2713${RESET} Removed system-tools from config`);
    log(`  ${DIM}Restart Claude Desktop to complete removal${RESET}`);
  } else {
    log(`  ${DIM}No decoy found in config${RESET}`);
  }
}

// Command router
const cmd = process.argv[2];

switch (cmd) {
  case "init":
    init().catch(e => { log(`  ${RED}Error: ${e.message}${RESET}`); process.exit(1); });
    break;
  case "status":
    status().catch(e => { log(`  ${RED}Error: ${e.message}${RESET}`); process.exit(1); });
    break;
  case "uninstall":
  case "remove":
    uninstall();
    break;
  default:
    log("");
    log(`  ${ORANGE}${BOLD}decoy-mcp${RESET} ${DIM}— security tripwires for AI agents${RESET}`);
    log("");
    log(`  ${WHITE}Commands:${RESET}`);
    log(`    ${BOLD}init${RESET}        Set up decoy protection for Claude Desktop`);
    log(`    ${BOLD}status${RESET}      Check your decoy status and recent triggers`);
    log(`    ${BOLD}uninstall${RESET}   Remove decoy from your config`);
    log("");
    log(`  ${DIM}Usage: npx decoy-mcp init${RESET}`);
    log("");
    break;
}
