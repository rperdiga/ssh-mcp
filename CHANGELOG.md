# Changelog

All notable changes to this project will be documented in this file.

The format is loosely based on Keep a Changelog.

## [1.1.0] - 2025-08-08
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
