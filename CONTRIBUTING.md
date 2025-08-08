# Contributing

Thanks for your interest in contributing!

## Ways to Help
- Report bugs (include reproduction steps)
- Improve documentation / examples
- Add small, focused features (open an issue first for larger changes)
- Refactor for clarity without changing behavior

## Development Setup
```bash
npm install
npm run build
```
Run locally (HTTP stream):
```bash
node build/index.js --host=127.0.0.1 --user=me --transport=stream --password=test
```

## Coding Guidelines
- Keep dependencies minimal
- Favor explicit error messages (wrap with McpError where appropriate)
- Avoid introducing breaking changes without discussion
- Stick to existing formatting (TS compiler output + minimal stylistic churn)

## Pull Requests
1. Fork the repo & create a topic branch
2. Make changes with clear commits
3. Update README / CHANGELOG if needed
4. Ensure `npm run build` succeeds
5. Open PR, reference related issues, describe rationale

## Security
Do not open a public issue for security-sensitive findings. Instead, please email the maintainer or open a private advisory if GitHub supports it for this repository.

## License
By contributing, you agree your contributions are licensed under the MIT License of this repository.
