@AGENTS.md

<!-- PROPOSAL, 2026-09-26. Not binding. Proposed replacement for the root
CLAUDE.md. Reasoning: 2026-09-26-agent-instructions-review.md. -->

# Claude-specific notes

AGENTS.md above is the shared source of truth; this file only adds to it.

## Working style

- **Explain your reasoning.** This codebase belongs to someone learning, so
  explain the reasoning behind a proposed change, not just the change.
- **Multi-step refactors:** survey the current state, show the plan, then
  execute in checkpoints.
- **New features:** present a plan and wait for approval before coding.
  Fix-lists and agreed remediation go straight to implementation.
- **Reversible questions:** decide them yourself and say so.

## Pipeline

- **Your loop:** write the change, get a Codex review, push a branch, open a
  PR, merge on green once the human approves that head, and let CI deploy.
- **Flag before merging:** destructive changes, and anything that affects the
  account.
- **Monitoring CI from the sandbox:** `gh run watch` 403s. Poll the Actions
  REST API in a bounded background loop (`docs/testing-and-ci.md` section
  12).
- **Shell commands:** keep them simple and single-purpose. Compound scripts
  stall on sandbox approval.

## Codex review

- **Use the plugin, never `codex exec`:**
  1. Launch the `codex:codex-rescue` agent with the framing. It returns a
     task id and will not fetch results.
  2. Use the `codex:status` skill to find the job file.
  3. Poll `~/.claude/plugins/data/codex-openai-codex/state/<repo-hash>/jobs/<task-id>.json`
     in a bounded background loop, and read `result.rawOutput`.

  Never tail the subagent transcript. If the plugin is broken, say so and ask.
- **When:** once on the plan for new work, and once on the diff before it
  ships. After a fix, re-review rather than closing the finding yourself.
- **Framing:**
  - Name the exact scope (a commit, `git diff main...HEAD`, or the working
    tree).
  - Say what you think is most likely wrong, and invite Codex to attack it.
  - Ask for a one-line `VERDICT:`.
  - Always ask it to confirm the invariants in AGENTS.md "Invariants".
- **Codex's sandbox is read-only:** it cannot run the build, the suites or the
  harness. Report which of you ran what.
- **Leave the automatic review gate disabled.**
