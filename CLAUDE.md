@AGENTS.md

# Claude-specific notes

AGENTS.md above is the shared source of truth; this file adds only what is
specific to working with Claude, and does not override it.

## Working style

- This codebase belongs to someone learning. Explain your reasoning when
  proposing a change, not just the change.
- Multi-step refactors: survey the current state, show the plan, then execute
  in checkpoints. Don't bundle structural decisions into one diff.
- Net-new features: present a plan and wait for approval before coding, even
  if the ask sounds like a go-ahead. Fix-lists and agreed remediation items go
  straight to implementation.
- Decide reversible questions yourself and say so. Don't park work awaiting a
  call that doesn't need making.
- Keep shell commands simple and single-purpose: compound scripts trip the
  sandbox analyzer and stall on approval.

## Pipeline

Claude owns the loop: write, get Codex to review adversarially, push a branch,
open a PR, merge on green once the human approves that exact head (AGENTS.md
"Shipping"). A merge does not deploy while `deploy.yml` is legacy. Flag
destructive or account-affecting changes before merging.

## Getting Codex to review

Review when a wrong answer is still cheap to change, and again before it
ships: for net-new work that usually means once on the plan and once on the
diff; for a fix-list, once on the diff is enough.

- **Use the plugin, never `codex exec`.** Launch the `codex:codex-rescue`
  agent. It is launch-only: it returns a task id (`task-...`) and will not
  fetch results. The job's state is `jobs/<task-id>.json` under the plugin's
  data directory (here
  `~/.claude/plugins/data/codex-openai-codex/state/<repo>-<hash>/`). Poll that
  exact file in a bounded background loop until `status` is `completed`,
  `failed` or `cancelled`, then read `result.rawOutput`, else `errorMessage`.
  If both are empty, say so and read the `<task-id>.log` beside it. Never tail the subagent's JSONL transcript; it overflows
  the context. If the plugin is broken, say so and ask - do not fall back to
  `exec`.
- **Frame it.** Name the exact scope (a commit, `git diff main...HEAD`, or the
  working tree), say what changed and what you think is most likely wrong,
  and ask for a one-line `VERDICT:`. Every review should confirm these
  AGENTS.md Invariants still hold: user scoping, the strict share DTO,
  ownership prechecks, and CSRF-then-auth.
- Never hand the human a slash command to paste (`/codex:adversarial-review`
  is user-invocation-only); that makes them the transport for delegated work.
- Codex's sandbox is read-only: its review is source-level and it cannot run
  the build, suites or CI lookups. Running the gates is yours; report which of
  you ran what.
- When a finding is fixed, re-review rather than declaring it closed.
- The plugin's automatic review gate is intentionally disabled; do not
  re-enable it.
