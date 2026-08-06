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

## Codex review policy

The automatic review gate is intentionally DISABLED. Do not re-enable it.
Reviews are explicit, at two gates:

- GATE 1, plan review (net-new features, before any code):
  `/codex:adversarial-review --background <plan framing + attack surfaces>`
  Wait for VERDICT; do not start implementation until the human approves the
  findings. Fix-lists skip GATE 1.
- GATE 2, change review (before commit, after build/lint/tests pass):
  `/codex:adversarial-review --base main --background <adversarial framing>`
  Required: VERDICT: MERGE | MERGE-WITH-FIXES | BLOCK.

Never use `/codex:review` - unsteerable, takes no custom focus text. If
`/codex:status` shows a job queued >5 min without starting, `/codex:cancel`
and fall back to direct `codex exec -s read-only`; say so in the transcript.

Standing invariants to name in every GATE 2 review prompt:

- Session-scoped ownership: authenticated repo queries filter by the
  better-auth session's user_id. Deliberate exceptions: the anonymous
  public-share read (slug-gated on is_shared) and system tables like
  rate-limit buckets.
- Locked public share projection: `GET /api/shares/:slug` returns only the
  strict share DTO (constants + wire-shape tests on RAW json).
- Ownership prechecks on writes taking client-supplied ids, under the D1
  100-param limit (owned-set membership in JS, chunked batches - never an
  unbounded `inArray`).
- CSRF + auth layering on app write routes (403 without the custom header,
  401 without session). Exception: `/api/auth/*` uses better-auth's own
  origin validation.
