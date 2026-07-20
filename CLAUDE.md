# Working with Claude on grampacker-next

**Read `AGENTS.md` first.** It is the shared source of truth for every agent in
this repo: the stack, the exact commands, the verification gate, the traps
(D1 param limit, `noUncheckedIndexedAccess`, optimistic-update blind spots), the
import boundary, git and supply-chain rules, security, and the Supabase-era
patterns that must not be reintroduced. Everything there applies to Claude.

This file adds only what is specific to working with Claude interactively. It
does not override AGENTS.md.

## Working style

- This codebase belongs to someone learning. Explain your reasoning when
  proposing a change, not just the change itself.
- Multi-step refactors: survey the current state, show the plan, then execute in
  checkpoints. Don't bundle structural decisions into a single diff.
- Present a plan and wait for approval before coding a net-new feature, even if
  the ask sounds like a go-ahead. Fix-lists can go straight to implementation.
- Decide reversible questions yourself and say so. Don't park work awaiting a
  call that doesn't need making.

## Pipeline

Claude owns the loop end to end: write, get Codex to review adversarially, push a
branch, open a PR, merge on green, and let CI deploy. The human's OK lands at the
outward gates.

- A merge to `main` IS a deploy (`.github/workflows/deploy.yml`), and it applies
  remote D1 migrations. Treat "approve this merge" as "approve this deploy", and
  flag destructive or account-affecting changes before merging.
- Branch protection will merge even while checks are still running, so for
  anything risky confirm CI is green yourself rather than trusting the gate.
- Codex reviews; it does not merge or deploy.

## Shell
- Never write polling loops (`while true; do ... sleep`). Use `gh run watch` to wait on CI.
- Keep commands simple and single-purpose - compound scripts trip the sandbox analyzer and stall on approval.

## Merge
- Always merge with `gh pr merge --auto --squash`. Never merge while checks are pending.

## Codex review policy

The review gate is intentionally DISABLED. Do not re-enable it.
Reviews are explicit and happen at two gates:

GATE 1 - Plan review (before any code is written)
  /codex:adversarial-review --background <plan framing + attack surfaces>
  Wait for VERDICT. Do not start implementation until I approve the findings.

GATE 2 - Change review (before commit, after lint/build/test pass)
  /codex:adversarial-review --base main --background <adversarial framing>
  Required: VERDICT: MERGE | MERGE-WITH-FIXES | BLOCK

Never use /codex:review - unsteerable, takes no custom focus text.

Queue fallback: if /codex:status shows a job queued >5 min without starting,
/codex:cancel it and fall back to the direct `codex exec -s read-only`
pattern. Say so in the transcript when you do.

Standing invariants to name in every GATE 2 review prompt:
  - session-scoped ownership: authenticated repo queries filter by the
    better-auth session's user_id; no route touches another user's rows.
    Deliberate exceptions: the anonymous public-share read (slug-gated on
    is_shared) and system tables like rate-limit buckets
  - locked public share projection: GET /api/shares/:slug (serving the
    /r/:slug SPA view) returns only the strict share DTO (constants +
    wire-shape tests on RAW json; no owner data leaks)
  - ownership prechecks on writes that take client-supplied ids, done
    under the D1 100-param limit (owned-set membership in JS, chunked
    batch statements - never an unbounded inArray)
  - CSRF + auth layering on app write routes (403 without the custom
    header, 401 without session). Exception: /api/auth/* uses
    better-auth's own origin validation, not the custom header
