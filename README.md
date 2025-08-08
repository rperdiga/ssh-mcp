# SSH MCP Server

[![NPM Version](https://img.shields.io/npm/v/ssh-mcp)](https://www.npmjs.com/package/ssh-mcp)
[![Downloads](https://img.shields.io/npm/dm/ssh-mcp)](https://www.npmjs.com/package/ssh-mcp)
[![Node Version](https://img.shields.io/node/v/ssh-mcp)](https://nodejs.org/)
[![License](https://img.shields.io/github/license/tufantunc/ssh-mcp)](./LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/tufantunc/ssh-mcp?style=social)](https://github.com/tufantunc/ssh-mcp/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/tufantunc/ssh-mcp?style=social)](https://github.com/tufantunc/ssh-mcp/forks)
[![Build Status](https://github.com/tufantunc/ssh-mcp/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tufantunc/ssh-mcp/actions)
[![GitHub issues](https://img.shields.io/github/issues/tufantunc/ssh-mcp)](https://github.com/tufantunc/ssh-mcp/issues)

**SSH MCP Server** is a lightweight Model Context Protocol (MCP) server that exposes SSH command execution for Linux and Windows targets. It lets MCP‑compatible clients (Claude Desktop, Cursor, MCP Inspector, etc.) run shell commands over SSH in a controlled, timeout‑aware way.

Licensed under the MIT License. See [LICENSE](./LICENSE).

## Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Client Setup](#client-setup)
- [Testing](#testing)
- [Security Notes](#security-notes)
- [Disclaimer](#disclaimer)
- [Support](#support)
- [Forking](#forking)

## Quick Start

1. Install (or clone & build) this package
2. Run the server (pick a transport: `stream` or `sse`)
3. Point your MCP client at it
4. Use the `exec` tool to run commands on the target host

## Features

- MCP-compliant server exposing SSH command execution
- Linux + Windows remote hosts supported (shell semantics may differ)
- Password or private key authentication
- TypeScript, minimal deps, official MCP SDK
- SSE (legacy) and HTTP Stream (modern, default) transports
- Execution timeout with best‑effort termination of the remote process
- Optional local fallback exec (set `MCP_LOCAL_EXEC=1`) for debugging

### Tools

- `exec`: Execute a shell command on the remote server
  - **Parameters:**
    - `command` (required): Shell command to execute on the remote SSH server
  - **Timeout Configuration:**
    - Timeout is configured via command line argument `--timeout` (in milliseconds)
    - Default timeout: 60000ms (1 minute)
    - When a command times out, the server automatically attempts to abort the running process before closing the connection

## Installation

### From NPM (recommended)
```bash
npm install -g ssh-mcp
```
Then run with:
```bash
ssh-mcp --host=1.2.3.4 --user=myuser --password=secret --transport=stream
```

### From Source
```bash
git clone https://github.com/tufantunc/ssh-mcp.git
cd ssh-mcp
npm install
npm run build
node build/index.js --host=1.2.3.4 --user=myuser --transport=stream
```

## Usage

Minimal example (HTTP Stream transport):
```bash
ssh-mcp --host=1.2.3.4 --user=myuser --password=secret --transport=stream --timeout=30000
```

SSE (legacy) transport:
```bash
ssh-mcp --host=1.2.3.4 --user=myuser --password=secret --transport=sse
```

Using an SSH key:
```bash
ssh-mcp --host=host.example --user=deploy --key=C:\\keys\\id_ed25519
```

Environment (optional):
```bash
set LOG_LEVEL=debug          # increase logging
set MCP_LOCAL_EXEC=1         # run commands locally (no SSH) for quick test
set MCP_AUTH_TOKEN=token123  # require Bearer token on requests
```

Batch launchers (Windows) included:
* `StartHTTPMCP.bat` – HTTP Stream (default)
* `StartSSEMCP.bat` – SSE
* `StartDocker-SSH.bat` – spins up a local Ubuntu SSH test container on port 2222

Run with `verbose` to enable extra logging, e.g.:
```bat
StartHTTPMCP.bat verbose
```

## Client Setup

You can configure Claude Desktop to use this MCP Server.

### Transports

| Transport | Flag | Endpoint(s) | Notes |
|----------|------|-------------|-------|
| HTTP Stream (default) | `--transport=stream` | `/mcp` | Single endpoint; SSE replacement |
| SSE (legacy) | `--transport=sse` | `/sse` + `/messages` | Retained for broad client compatibility |

### Parameters
Required:
* `--host` target host/IP
* `--user` SSH username

Common optional:
* `--sshPort=<n>` (default 22)
* `--listenPort=<n>` (HTTP listen port, default 3001)
* `--listenHost=<host>` bind address (default 127.0.0.1)
* `--password=<pwd>` password auth
* `--key=<path>` private key (overrides password if both given)
* `--timeout=<ms>` command timeout (default 60000)
* `--transport=stream|sse`


### Claude Desktop (Custom Connectors)

Claude Desktop now supports Custom Connectors for HTTP-based MCP servers. See the [Custom Connectors guide](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) for setup instructions.

1. Start your SSH MCP server locally:
   ```bash
   ssh-mcp --host=your-server.com --user=myuser --password=secret --transport=sse
   ```

2. In Claude Desktop, add a Custom Connector:
   - **Name**: SSH MCP Server
   - **URL**: `http://localhost:3001/sse` (SSE transport)
   - **Type**: Server-Sent Events

   Or for HTTP Stream transport:
   - **URL**: `http://localhost:3001/mcp`
   - **Type**: HTTP Stream

### GitHub Copilot Configuration

GitHub Copilot supports MCP through the `mcp.json` configuration file. Create or edit your `mcp.json` file:

**Location:** `%APPDATA%\Code\User\mcp.json` (Windows) or `~/.config/Code/User/mcp.json` (Linux/Mac)

```jsonc
{
  "servers": {
    "ssh-mcp": {
      "url": "http://localhost:3001/sse",
      "type": "http"
    }
  },
  "inputs": []
}
```

Start your server and GitHub Copilot will automatically connect:
```bash
ssh-mcp --host=your-server.com --user=myuser --password=secret --transport=sse
```

**Note:** Use SSE transport (`/sse` endpoint) for maximum compatibility with both Claude and GitHub Copilot.

### Direct Node Invocation (from source build)
```bash
node build/index.js --transport=stream --listenPort=3001 --host=1.2.3.4 --sshPort=22 --user=root --password=pass --timeout=30000
```

## Testing

Inspector:
```bash
npm run build
npx @modelcontextprotocol/inspector http://127.0.0.1:3001/mcp
```

Local SSH test container (Windows, Docker required):
```bat
StartDocker-SSH.bat
StartHTTPMCP.bat -- then connect with --host=127.0.0.1 --sshPort=2222 --user=computeruse --password=computeruse
```

Switch to SSE for clients that require it:
```bash
ssh-mcp --transport=sse --host=127.0.0.1 --user=me --password=secret
```

Local command mode (no SSH network hop):
```bash
set MCP_LOCAL_EXEC=1
ssh-mcp --host=localhost --user=ignored --transport=stream
```

## Security Notes

Production considerations:
* Prefer key auth over passwords
* Run behind a firewall / localhost + SSH tunnel
* Set `MCP_AUTH_TOKEN` to require a bearer token
* Restrict origins with `ALLOWED_ORIGINS` env
* Use network segmentation for sensitive hosts
* Review (and possibly wrap) the `exec` tool if you need command allow‑listing

## Disclaimer

SSH MCP Server is provided under the [MIT License](./LICENSE). Use at your own risk. This project is not affiliated with or endorsed by any SSH or MCP provider.

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](./CONTRIBUTING.md) for more information.

## Code of Conduct

This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md) to ensure a welcoming environment for everyone.

## Support

If this project helps you, a star ⭐ or feedback issue is appreciated. Pull requests welcome.

See also:
* [Changelog](./CHANGELOG.md)
* [Contributing](./CONTRIBUTING.md)
* [Code of Conduct](./CODE_OF_CONDUCT.md)
* [Forking Guide](./FORKING.md)

## Forking

If you maintain a fork, please:
1. Add lineage details in `CHANGELOG.md` under `[Unreleased] > Fork Lineage`.
2. Keep `FORKING.md` updated with your policies.
3. Use distinct version tags (e.g. `v1.1.0-fork.1`).
4. Change the npm package name if you republish.

See [FORKING.md](./FORKING.md) for full instructions.
\n+### Releases & Publishing
\n+Automated npm publishing is configured via `.github/workflows/release.yml` and triggers on tags named `v*` (e.g. `v1.1.1`).\n+\n+Workflow summary:\n+1. Update `CHANGELOG.md` under `[Unreleased]` and move entries to a new version heading.\n+2. Commit changes.\n+3. Bump version & create tag (pick one):\n+   ```bash\n+   npm run release:patch   # or release:minor / release:major\n+   ```\n+   These scripts: update version, commit, tag.\n+4. Push commits & tags:\n+   ```bash\n+   git push && git push --tags\n+   ```\n+5. GitHub Action builds and publishes (requires `NPM_TOKEN` secret).\n+\n+Manual alternative:\n+```bash\n+npm version patch -m "chore: release %s"\n+git push && git push --tags\n+```\n+\n+Repository secret required:\n+* `NPM_TOKEN` – npm auth token with publish rights. Add via GitHub Settings → Secrets → Actions.\n+\n+If forking & publishing under a different name, change the `name` field in `package.json` before the first publish.\n*** End Patch