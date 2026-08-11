@AGENTS.md

# Claude-specific notes for grampacker-next

AGENTS.md above is the shared source of truth; this file only adds what is
specific to working with Claude interactively and does not override it.

## Working style

- This codebase belongs to someone learning. Explain your reasoning when
  proposing a change, not just the change itself.
- Multi-step refactors: survey the current state, show the plan, then execute
  in checkpoints. Don't bundle structural decisions into a single diff.
- Net-new features: present a plan and wait for approval before coding, even
  if the ask sounds like a go-ahead. Fix-lists and agreed remediation items go
  straight to implementation.
- Decide reversible questions yourself and say so. Don't park work awaiting a
  call that doesn't need making.

## Pipeline

Claude owns the loop end to end: write, get Codex to review adversarially,
push a branch, open a PR, merge on green, let CI deploy. The human's OK lands
at the outward gates (merge = deploy; flag destructive or account-affecting
changes before merging).

- Merge procedure is in AGENTS.md "Roles": confirm CI green yourself with
  `gh run watch` / `gh pr checks`, then
  `gh pr merge --squash --match-head-commit <sha>`. Branch protection does
  not wait for checks, so `--auto` is not a safety net.
- Never write polling loops (`while true; do ... sleep`); use `gh run watch`.
- Keep shell commands simple and single-purpose - compound scripts trip the
  sandbox analyzer and stall on approval.

## Getting Codex to review

**Review when a wrong answer is still cheap to change, and again before it
ships.** For net-new work that usually means once on the plan and once on the
diff; for a fix-list, once on the diff is enough. The point is an independent
reader who has to actually follow the reasoning - not a ceremony to perform.

Run it yourself: `codex exec -s read-only "<framing>"`, in the background, and
report the verdict. **Name the scope in the framing** - the exact commit, or
`git diff main...HEAD`, or the working tree. Without that, a review of a clean
feature branch can look at nothing and still answer. Do NOT hand the human a slash command to paste - that
makes them the transport for work they delegated. (`/codex:adversarial-review`
is user-invocation-only and cannot be called on their behalf.) Ask for a
one-line `VERDICT:` so the outcome is unambiguous.

A review is only as good as its framing. Say what changed, say what you think
is most likely to be wrong, and invite the reviewer to attack that - a prompt
that just says "review this" gets prose back. When a finding is fixed,
re-review rather than declaring it closed yourself.

The automatic review gate is intentionally disabled; do not re-enable it.

What a review of this repo should always confirm, because these are the
invariants that would hurt most if they broke:

- Authenticated queries are scoped to the session's user. The known
  exceptions are the anonymous share read (slug-gated on `is_shared`) and
  system tables like rate-limit buckets.
- The public share returns only its strict DTO, asserted on raw JSON.
- Writes taking client-supplied ids precheck ownership, within D1's
  100-parameter limit.
- CSRF + auth layering on app write routes (403 without the custom header,
  401 without session). Exception: `/api/auth/*` uses better-auth's own
  origin validation.
