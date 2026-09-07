---
name: sync-pi-stack
description: >
  One-flow sync and verify of the whole managed pi stack: upstream pi + local
  build + nodeenv install, installed pi packages/extensions, local-source
  plugins (pi-mcp-adapter etc.), and local MCP server binaries. Use when the
  user asks to sync/refresh the pi stack, update pi and its plugins/MCPs
  together, or when anything that executes drifted from its source. Extends
  the update-pi skill (binary slice) to the layers around the binary.
argument-hint: "[--verify-only]"
---

# Sync the managed pi stack

Sync every layer that executes, then verify the executing artifacts — not the
sources. The skill is verify-driven: measure staleness first, update second,
re-verify third. With `--verify-only`, run phases 1 and 4 and stop (read-only
drift report).

## Managed layers (discover, don't assume)

| Layer | Source of truth | Executing artifact |
|---|---|---|
| pi binary | `/home/rahul/Documents/pi-stack/pi` (branch: current working branch) | `~/nodeenv2251-311/bin/pi` via `~/.local/bin/pi` nudge wrapper |
| pi packages | `packages` list in `~/.pi/agent/settings.json` | `~/.pi/agent/npm/node_modules/` |
| Local-source plugins | e.g. `/home/rahul/Documents/pi-mcp-adapter` | same node_modules copy |
| Extensions (global) | `~/Documents/pi-stack/agent-extensions` (versioned copy) | `~/.pi/agent/extensions/*.ts` (runtime; loaded by pi at startup) |
| GLM/DeepSeek loop harness | `~/Documents/pi-stack/pi-glm-deepseek-loop-harness` (self-committed) | MetaBuilder run-roots under its `run-root-v*` dirs |
| MCP servers | `~/.pi/agent/mcp.json` | the command each entry points at (local builds live under their own repos, e.g. `/home/rahul/Documents/cultivar/target/release/cultivar-mcp`) |

`pi install <source>`, `pi update [self|extensions|<source>]`, and `pi list`
are the package CLI surfaces. `~/.local/bin/pi` routes infra commands to the
real nodeenv binary; always verify against `~/nodeenv2251-311/bin/pi`.

## Phase 1 — Verify-before drift manifest (always run, read-only)

Collect and report BEFORE changing anything:

```bash
~/nodeenv2251-311/bin/pi --version          # executing binary version
cd /home/rahul/Documents/pi-stack/pi
git fetch origin main
git rev-list --left-right --count HEAD...origin/main   # binary drift vs upstream
grep '"version"' packages/coding-agent/package.json    # source version
```

Package drift — compare installed vs source-of-truth:

```bash
~/nodeenv2251-311/bin/pi list
for p in npm/pi-mcp-adapter npm/pi-web-access; do
  python3 -c "import json;print('$p installed:', json.load(open('/home/rahul/.pi/agent/npm/node_modules/${p#npm/}/package.json'))['version'])" 2>/dev/null
done
# Local-source plugins: compare source version in their repo package.json
```

MCP binary freshness — command exists, and mtime vs its source (report only):

```bash
python3 - <<'EOF'
import json, os
for name, s in json.load(open(os.path.expanduser('~/.pi/agent/mcp.json')))['mcpServers'].items():
    cmd = s.get('command')
    print(name, 'OK' if not cmd or os.path.exists(cmd) else 'MISSING', cmd or s.get('url'))
EOF
```

Global-extension drift — runtime vs versioned copy (report only; the runtime
(`~/.pi/agent/extensions`) is authoritative for loading, the pi-stack copy is
the versioned record):

```bash
diff -rq ~/.pi/agent/extensions ~/Documents/pi-stack/agent-extensions \
  --exclude=.git --exclude=node_modules && echo EXTENSIONS-IN-SYNC
```

Surface every drift in the report. Do not proceed silently past a MISSING mcp
command — report it and ask.

## Phase 2 — pi binary (update-pi procedure)

Run the update-pi skill flow completely: read
`/home/rahul/Documents/pi-stack/pi/.pi/skills/update-pi/SKILL.md` and execute its
steps 1-8 (fetch/merge upstream, resolve conflicts, build, verify, commit,
local-release install into the nodeenv). Never reset or discard local commits.
If the user asked only to refresh plugins/MCPs and drift shows zero incoming
upstream commits with the executing binary already matching repo HEAD, skip to
phase 3 and say so.

## Phase 3 — pi packages and local-source plugins

```bash
~/nodeenv2251-311/bin/pi update --extensions          # refresh npm/git packages
~/nodeenv2251-311/bin/pi update --models              # refresh model catalogs
```

- Pinned packages (e.g. `npm:pi-mcp-adapter@2.21.1`) are updated by their
  pinned spec; if a local source repo (e.g. `/home/rahul/Documents/pi-mcp-adapter`)
  is newer than installed, reinstall from that source and re-pin, or `pi install`
  it fresh. Never silently downgrade a locally newer plugin to an older npm spec.
- git-pinned packages (`git:...@<sha>`) advance only when the user asks; report
  the pinned sha vs the repo's default branch in the phase-1 manifest.
- Global extensions (`~/.pi/agent/extensions/*.ts`) are source; nothing to
  build. If phase 1 showed drift, copy changed files into
  `~/Documents/pi-stack/agent-extensions` and commit there so the versioned
  copy stays truthful.
- The GLM/DeepSeek loop harness lives at
  `~/Documents/pi-stack/pi-glm-deepseek-loop-harness`; its `target/` checkout
  must track this repo (check with
  `git -C .../pi-glm-deepseek-loop-harness/target remote get-url origin`)
  before running any governed epoch. It is out of scope for routine stack
  syncs — only verify the remote binding.

## Phase 4 — Verify-after (executing artifacts)

```bash
~/nodeenv2251-311/bin/pi --version          # matches packages/coding-agent/package.json
~/nodeenv2251-311/bin/pi list               # every package resolves; versions reported
~/nodeenv2251-311/bin/pi -p "Say exactly: ok"   # real prompt through the real binary
```

- Binary version must equal the repo source version. A mismatch means phase 2's
  install silently failed — diagnose, do not paper over.
- Every settings.json package must appear in `pi list` with its expected version.
- Every mcp.json command must exist on disk. Local Rust builds (cultivar) are
  fresh only if built after their last source change — report, and rebuild
  only on request.

## Phase 5 — Report

Emit a compact manifest table: layer / source state / executing state / verdict
(fresh | updated | stale-needs-build | missing). Include the phase-1 vs phase-4
delta so staleness that was repaired (or found) is explicit. If anything remains
stale or missing, name the exact command to repair it and stop.

## Gotchas

- `pi list` currently exits 2 with an MCP direct-tools warning (pi-mcp-adapter
  registers 134 direct tools; README recommends 5-20). That is a context-size
  advisory, not an install failure — judge by the package list, not the exit
  code.
- `pi update` (no args) updates pi itself — for the managed nodeenv that is NOT
  what we want; phase 2's local-release install is the authoritative binary
  update. Avoid `pi update --all` unless the user explicitly wants registry pi.
- The nudge wrapper (`~/.local/bin/pi`) routes `pi daemon/status/...` elsewhere —
  verify with the real binary path.
- After `pi update --extensions`, a pinned-version spec may re-pin older than a
  local source; re-check versions after, not before.
- `pi update --models` needs network; a failure here is upstream, not local.
