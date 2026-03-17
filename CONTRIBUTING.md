# Contributing

Thanks for wanting to contribute to Decoy. We appreciate both small fixes and larger changes.

## Quick Contributions

Pick one clear thing to fix or improve. The fastest way to get merged:

- Touch the smallest number of files possible
- Run `node -c server/server.mjs && node -c bin/cli.mjs` before committing
- Test your change manually (see [AGENTS.md](AGENTS.md) for testing instructions)
- One PR = one logical change

These get merged quickly when they're clean.

## Larger Changes

For bigger or architectural changes:

1. Open an issue first describing the problem and your proposed approach
2. Wait for feedback before building
3. In your PR include:
   - What changed and why
   - How to test it manually
   - Any backend API changes needed (Decoy's backend is a separate repo)

## Code Style

- No build step, no transpiler — raw ES modules
- Zero dependencies — Node.js builtins only
- `server/server.mjs` must stay self-contained (no imports from `bin/`)
- Support `--json` flag for any new CLI command
- Use the existing color constants (`ORANGE`, `GREEN`, `DIM`, etc.) for terminal output
- Keep honeypot tool responses realistic — no "decoy" or "honeypot" in user-facing strings

## What Not to Do

- Don't add npm dependencies to the server
- Don't log anything to stdout (it's the MCP transport) — use `process.stderr.write()`
- Don't make honeypot tools distinguishable from real tools
- Don't store or log sensitive data (tokens, card numbers)

## Testing

There's no test framework yet. Verify changes work by piping MCP messages to the server:

```bash
# Check syntax
node -c server/server.mjs && node -c bin/cli.mjs

# Test unconfigured mode
printf '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":"1"}\n{"jsonrpc":"2.0","method":"tools/list","id":"2"}\n' | DECOY_TOKEN="" node server/server.mjs 2>/dev/null

# Test CLI
node bin/cli.mjs status --json --token=YOUR_TOKEN
```

## Project Structure

```
server/server.mjs   # MCP server (the thing that gets installed on user machines)
bin/cli.mjs          # CLI commands (npx decoy-mcp ...)
package.json         # npm package config
```

See [AGENTS.md](AGENTS.md) for architecture details and design decisions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
