---
name: update-pi
description: >
  Update the local pi monorepo branch with upstream main/master, resolve all
  merge conflicts, verify with typecheck + tests, and install the resulting
  local build into the managed nodeenv so the executed pi binary (and its
  model catalog) is current. Use when the user asks to update pi, sync pi
  with main/master, refresh pi's models, or after upstream releases.
---

# Update local pi from upstream

## Environment facts (verify, don't assume)

- **Repo:** `/home/rahul/Documents/pi-stack/pi` (monorepo, packages/ai, packages/coding-agent, etc.)
- **Working branch:** usually `fix/compaction-and-tool-arguments` — carry local commits
  forward by merging upstream, never by resetting.
- **Remotes:** `origin` = upstream (earendil-works/pi), `fork` = user's GitHub fork.
- **Executed binary chain:** `~/.local/bin/pi` (nudge wrapper) routes infra commands to
  the real binary at `NUDGE_PI_BIN` (default `~/nodeenv2251-311/bin/pi`), which is a
  global npm install of `@earendil-works/pi-coding-agent`. Updating that nodeenv install
  is what actually changes the executed pi.

## Procedure

### 1. Fetch and assess drift

```bash
cd /home/rahul/Documents/pi-stack/pi
git fetch origin main
git rev-list --left-right --count HEAD...origin/main   # local-only vs upstream-only commits
git log --oneline HEAD..origin/main                    # what's incoming (releases, model data)
```

### 2. Merge upstream into the working branch

```bash
git merge --no-commit --no-ff origin/main
```

### 3. Resolve ALL conflicts (none may remain)

Inspect every conflict hunk and understand **both sides** before choosing:

- Upstream often landed the same fix independently (e.g. #7048 truncated-summary
  rejection). Prefer upstream's structure for shared logic so future merges stay small;
  keep genuinely local additions (e.g. `effectiveReserveTokens`, the degenerate-summary
  guard) that upstream lacks.
- Merge imports when both sides add symbols from the same module.
- For tests: adopt upstream's expected messages when its behavior supersedes the local
  variant, and delete the now-duplicated local test; update any remaining local tests
  (including `test/suite/regressions/*`) that assert the old message.
- CHANGELOG conflicts: keep both sides' entries (upstream first, then local).

After editing, verify no markers remain (note `======` comment separators are fine):

```bash
grep -rn '<<<<<<<\|>>>>>>>' packages/*/src packages/*/test
git add -A
```

### 4. Install deps and build everything

```bash
npm install --ignore-scripts
npm run build        # full build; partial builds cause phantom test failures (see Gotchas)
```

### 5. Verify before committing

```bash
cd packages/coding-agent
npx tsgo --noEmit                                # typecheck
npx vitest run test/suite                        # full regression suite
```

Rules:

- Every failure must be explained before committing: is it (a) a conflict-resolution
  error, (b) a pre-existing local-branch failure, or (c) upstream behavior change?
- To check (b) without polluting history, commit the merge first, then investigate —
  `git bisect` needs a clean tree. Bisect between `git merge-base HEAD origin/main`
  and the pre-merge HEAD.
- Beware stale-dist phantom failures: if a test passes solo but fails in the suite
  (or vice versa), do a full `npm run build` and re-run before diagnosing logic bugs.
  Compare against a pristine `git worktree add /tmp/check origin/main` when unsure.
- The repo's pre-commit hook runs `biome check`, pinned-dep/shrinkwrap/install-lock
  checks, `tsgo --noEmit`, and a browser smoke test. Fix what it reports; do not skip it.

### 6. Commit the merge

```bash
git commit   # message: merge(upstream): bring <branch> up to date with origin/main
             # + per-conflict resolution notes + known-issues notes
```

### 7. Install the local build into the nodeenv

```bash
cd /home/rahul/Documents/pi-stack/pi
node scripts/local-release.mjs --skip-check --skip-test --skip-install \
  --out /tmp/pi-local-tarballs --force
cd /tmp/pi-local-tarballs/tarballs
npm install -g --prefix /home/rahul/nodeenv2251-311 ./*.tgz
```

Installing all tarballs at top level satisfies the `^0.84.x` workspace-dep ranges with
the local builds instead of registry copies.

### 8. Verify the executed pi

```bash
pi --version    # must match the repo's package.json version
```

Model freshness comes from the build: `packages/ai`'s `models.generated.js` is
regenerated during `npm run build` (needs network).

## Gotchas

- `npm warn Unknown project config "min-release-age"` is harmless.
- `npm run build` inside a fresh worktree may fail in packages/ai (`generate-models`
  needs network); the main repo build is authoritative.
- Never leave a merge half-resolved across sessions; finish or fully abort.
- The nudge wrapper means `pi daemon/status/run/...` routes elsewhere — test the real
  binary with infra flags like `--version`, `--help`, or `-p`.
