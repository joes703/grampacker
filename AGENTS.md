# AGENTS.md

Repository instructions for AI agents (Codex, Claude Code, and other tools that
read `AGENTS.md` by convention).

This file is intentionally a short, stable pointer. It does NOT duplicate the
project's working agreements or any generated session memory. Read the
authoritative docs below.

## Start here

- **`CLAUDE.md`** - the canonical agent working agreement: verification rules
  (`npm run build`, the `DB Tests` pgTAP CI job), TypeScript gotchas, database
  and cache-invalidation patterns, the domain model, UX/density rules, and the
  explicit "what NOT to do" list. Read this first and follow it exactly.

## Authoritative project docs

- `SPEC.md` - product behavior and data contracts (incl. CSV import/export).
- `DECISIONS.md` - architecture decision records (ADRs).
- `SECURITY.md` - RLS model and the public-read projection allowlist.
- `README.md` - project overview and local setup.
- `docs/ui-density.md` - row/table density and the flat-table visual system.
- `docs/github-workflow.md` - branch/PR/merge workflow (squash-only, auto-merge).
- `docs/supply-chain-security.md` - npm/lockfile and `.npmrc` policy.

## Note on generated memory

A local memory plugin (claude-mem) may overwrite this file's working copy with a
`<claude-mem-context>` session dump. That generated content is machine-local and
must never be committed.

To stop the dump from showing up in `git status`, protect the working copy
per-clone:

    git update-index --skip-worktree AGENTS.md

Re-apply that on every fresh clone if the plugin clobbers the file. To restore
this stub after a clobber you must clear the flag first (skip-worktree blocks
`git checkout`):

    git update-index --no-skip-worktree AGENTS.md
    git checkout AGENTS.md
    git update-index --skip-worktree AGENTS.md

If a memory dump ever appears staged, do NOT commit it.
