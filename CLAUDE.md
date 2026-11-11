@AGENTS.md

# Claude-specific notes

AGENTS.md above is the shared source of truth; this file adds only what is
specific to Claude.

## Working style

- The owner is learning. Explain the reasoning behind a proposed change in
  plain terms, not just the change.
- Multi-step refactors: survey the current state, show the plan, then work in
  checkpoints.
- Net-new features: present a plan and wait for approval, even if the ask
  sounds like a go-ahead. Fix-lists and agreed remediation go straight to
  work.
- Decide reversible questions yourself and say so.

## Codex review

Claude writes, Codex reviews adversarially, Claude ships (AGENTS.md
"Shipping"). Review while a wrong answer is still cheap: net-new work on the
plan and the diff, a fix-list on the diff, and again after fixing a finding.

- Launch the `codex:codex-rescue` agent; never `codex exec`. Keep the
  plugin's automatic review gate off.
- Name the exact scope (a commit, `git diff main...HEAD`, or the working
  tree), what changed and what you suspect, and ask for a one-line
  `VERDICT:`. Every review confirms the AGENTS.md invariants: user scoping,
  the strict share DTO, ownership prechecks, CSRF-then-auth.
- The agent only launches and returns a task id. Find `jobs/<task-id>.json`
  in the plugin's state directory (it varies by install; search by task id),
  poll it in a bounded background loop until `status` is `completed`,
  `failed` or `cancelled`, then read `result.rawOutput`, else
  `errorMessage`, else the `<task-id>.log` beside it. The subagent's JSONL
  transcript overflows context; leave it unread. If the plugin is broken, say
  so and ask.
- Codex's sandbox is read-only: it reviews source and cannot run the build
  or test suites. You run the gates and report who ran what.
- Do the delegating yourself; a slash command handed to the human makes them
  the transport.
