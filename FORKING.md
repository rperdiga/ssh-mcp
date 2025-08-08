# Forking Guide

This document explains how to maintain your fork of this project.

## 1. Create Your Fork
Use the GitHub web UI to fork the repository. Clone your fork:
```bash
git clone https://github.com/<your-user>/ssh-mcp.git
cd ssh-mcp
git remote add upstream https://github.com/tufantunc/ssh-mcp.git
```

## 2. Keep Fork Updated
Synchronize with upstream periodically:
```bash
git fetch upstream
# Rebase onto upstream main (preferred for clean history)
git checkout main
git rebase upstream/main
# Or merge if you prefer merge commits
git merge upstream/main
```

## 3. Add Your Changes
Create a topic branch for any change:
```bash
git checkout -b feature/my-enhancement
```
Commit small, logical units. Update the following when relevant:
- `CHANGELOG.md` (add under `[Unreleased]`)
- `README.md` (if user-visible behavior changes)
- `FORKING.md` (if fork policy changes)

## 4. Document Lineage
At initial fork, record in `CHANGELOG.md` (Unreleased > Fork Lineage):
```
Upstream: https://github.com/tufantunc/ssh-mcp
Forked from commit: <commit sha>
License of upstream: MIT
```

## 5. Release Your Fork
Tag releases using semantic versioning with a distinct namespace if desired (e.g. `1.1.0-fork.1`). Example:
```bash
git tag v1.1.0-fork.1
git push origin v1.1.0-fork.1
```

## 6. Handle Upstream Changes
When upstream publishes new versions:
1. Fetch: `git fetch upstream`
2. Rebase: `git rebase upstream/main`
3. Resolve conflicts, run build, test
4. Update `CHANGELOG.md` summarizing upstream incorporation.

## 7. Publishing to npm (Optional)
If you publish under a different name:
1. Change `name` in `package.json` (e.g. `ssh-mcp-fork`)
2. Add a note in README linking back to upstream
3. Run `npm publish --access public`

## 8. Divergence Policy (Optional Template)
Define in your fork if you will:
- Track upstream regularly (Y/N)
- Backport security fixes (Y/N)
- Maintain API compatibility (Y/N)

## 9. License
Retain upstream MIT license and add attribution if required by your organization policy.

## 10. Common Pitfalls
- Forgetting to update `CHANGELOG.md`
- Publishing under the same npm name (will fail)
- Large unreviewed divergence making merges harder later

---
Happy hacking! Keep a clean history and clear documentation to help future contributors of your fork.
