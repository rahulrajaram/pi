# pi-stack migration plan (ratified, not yet executed)

Status: PLANNED. Do not execute while other pi sessions are running from
`/home/rahul/Documents/pi`. This file is the authoritative record of the
principal's decisions; execute it as written unless the principal overrides.

## Ratified decisions (principal, this session)

1. Umbrella directory: `~/Documents/pi-stack` (name confirmed: "pi-stack").
2. The pi monorepo moves to `~/Documents/pi-stack/pi`.
3. Everything immediately pi-coding-agent-related in `~/Documents` moves in as
   siblings of the repo.
4. Global extensions stay as runtime files in `~/.pi/agent/extensions/`, but a
   versioned copy lives inside pi-stack (see step 6).
5. Hardcoded absolute paths in skills, loop-harness docs, and handoff files
   must be fixed as part of the migration.

## Scope: what moves

Moves into `~/Documents/pi-stack`:

| Item | From | To |
|---|---|---|
| pi monorepo | `~/Documents/pi` | `~/Documents/pi-stack/pi` |
| pi-mcp-adapter (source) | `~/Documents/pi-mcp-adapter` | `~/Documents/pi-stack/pi-mcp-adapter` |
| pi-subagents (clone) | `~/Documents/pi-subagents` | `~/Documents/pi-stack/pi-subagents` |
| GLM/DeepSeek loop harness | `~/Documents/pi/pi-glm-deepseek-loop-harness` (untracked) | `~/Documents/pi-stack/pi-glm-deepseek-loop-harness` |

Explicitly NOT moved (independent projects that serve pi, not extensions of
it — principal may relocate later with a single `mv`): `nudge`, `haake`,
`overwatch`, `cultivar`.

## Known blockers at planning time

- Multiple live pi sessions were running with cwd `~/Documents/pi`
  (including a dev session via `pi-test.sh`/`tsx`, pid 3560507 at planning
  time). Migration must wait for a quiet window: no process with cwd under
  `/home/rahul/Documents/pi` except the migrating agent's own.

## Execution steps

1. **Quiet-window check.** No live processes with cwd `/home/rahul/Documents/pi`
   or below (check `/proc/*/cwd`). Session transcripts dir names are
   path-derived; history splits at the move — cosmetic, signal extractor is
   unaffected (it scans by filename date).
2. **Order of moves.** Move the loop harness OUT first
   (`mv ~/Documents/pi/pi-glm-deepseek-loop-harness ~/Documents/pi-stack/`),
   then the repo (`mv ~/Documents/pi ~/Documents/pi-stack/pi`), then
   `pi-mcp-adapter` and `pi-subagents`.
3. **Transitional symlink (safety net).** `ln -s pi-stack/pi ~/Documents/pi`.
   Old absolute paths keep working for anything missed; git operations via
   either path hit the same .git. Decide at the end whether to keep or remove
   it — removing is the clean end state, keeping costs nothing but hides
   drift.
4. **Repoint the governed loop.**
   `git -C ~/Documents/pi-stack/pi-glm-deepseek-loop-harness/target remote
   set-url origin /home/rahul/Documents/pi-stack/pi`. The loop's
   run-root-v4 journal binds git identity, not paths — verify with
   `metabuilder run status --run-root run-root-v4 --reconcile --json`.
5. **Path-fix sweep** (grep `Documents/pi` — beware matching
   `pi-mcp-adapter`/`pi-glm-deepseek-loop-harness` strings):
   - repo-local: `.pi/skills/update-pi/SKILL.md`,
     `.pi/skills/sync-pi-stack/SKILL.md`, `NEXT_SHELL_PROMPT.md`, repo
     `AGENTS.md` if it hardcodes the path.
   - global skills: `~/.pi/agent/skills/**` (handoff, metabuilder, etc.).
   - `~/.pi/agent/AGENTS.md` if it hardcodes the path.
   - loop harness docs and any script in the loop dir.
6. **Version the global extensions.** Copy `~/.pi/agent/extensions/` to
   `~/Documents/pi-stack/agent-extensions/`, `git init` + initial commit
   there. Runtime dir stays authoritative for loading; `sync-pi-stack`
   gains a drift check comparing the two (runtime vs versioned copy).
7. **Re-trust.** pi's `~/.pi/agent/trust.json` is path-keyed; the first
   session started from the new path must re-trust the project.
8. **Verify.** From the new root: git status/log intact, remotes correct
   (origin earendil-works/pi, fork rahulrajaram/pi), loop target remote
   points at the new repo path, `sync-pi-stack --verify-only` manifest clean,
   real binary still 0.84.4 from `~/nodeenv2251-311` (binary is
   path-independent; no reinstall needed).
9. **Record.** Update haake memory `pi-stack-migration-plan` checkpoint to
   completed; append outcome to this file.

## Rollback

Every step is a `mv` + symlink + text edit; reverse in the same order. Git
history, remotes, objects, and the nodeenv install are path-independent and
survive both directions.
