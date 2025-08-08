# Changelog

All notable changes to this project/fork are documented here.

The format is loosely based on Keep a Changelog.

## [Unreleased]
### Planned / Pending
- (Add new changes here after forking or before next tag)

### Fork Lineage
- This is a fork of the original ssh-mcp project.
  - Upstream: https://github.com/tufantunc/ssh-mcp
  - Forked from commit: 1682152
  - License of upstream: MIT## [1.1.0] - 2025-08-08
### Added
- HTTP Stream transport (default) alongside legacy SSE transport.
- Execution timeout with best‑effort remote process termination.
- Windows batch launchers (HTTP, SSE, Docker test container).
- `server_info` diagnostic tool.

### Changed
- Reduced default logging; verbose mode opt-in via batch `verbose` argument.
- README overhaul (usage, security notes, Docker test instructions).

### Removed
- STDIO transport (focusing on HTTP-compatible transports).

### Security
- Added optional bearer auth via `MCP_AUTH_TOKEN` environment variable.

---
Older historical changes prior to 1.1.0 were not tracked in this file.
