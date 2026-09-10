# Remediation report — 2026-09-10 engineering audit

| | |
| --- | --- |
| Audit | `docs/audits/2026-09-10-engineering-audit.md` (commit `76dcc20`) |
| Audited baseline | `373cf05` (`main`) |
| Remediation branch | `audit-remediation-2026-09-10` |
| Remediation range | `76dcc20..7b3316c` (nine commits after the audit document) |
| Primary engineer | Claude |
| Independent reviewer | OpenAI Codex (read-only; plan and diff review per cluster, plus a whole-branch review and an adversarial pass) |
| Status | complete; not pushed, not merged |

**Dated record.** This describes what changed after the audit and why. It does
not amend the audit, which records the repository as it stood at `373cf05`.
Nothing here is binding; the binding documents were corrected in the commits
listed below and are the authority.

## Baseline

- Original audited SHA: `373cf05`.
- Audit-document commit: `76dcc20` (the only change: the audit file).
- Remediation starting SHA: `76dcc20` (working tree clean; no pre-existing
  uncommitted work).
- Ending SHA: `7b3316c`.
- Local `main` was left at `373cf05`; every commit is on the remediation branch.
- Untouched, by design: `migrations/`, `scripts/check-migration-safety.mjs`,
  `package.json`, `package-lock.json`. No dependency changed. `npm audit fix`
  was never run.

## Commits

| SHA | Cluster | Summary |
| --- | --- | --- |
| `579d04b` | 2 | F1: worn rows out of List-view reorder planning |
| `1bd7bb2` | 1 | F4, F5: bound params and magic links out of logs; email fails closed |
| `23f3556` | 3 | F2: magic-link purge folds case |
| `4a8a567` | 4 | F6-F13: narrow food / gear-delete cache / cost / first-list paths |
| `6f2fc0a` | 5 | F19, F20: authorization-matrix cells; behavioral footer test |
| `1be260e` | 6 | F15: reorder planners extracted; shared worn-row rule |
| `54b89e6` | 7 | F18: dead and duplicate code removed |
| `c011218` | 8, 9 | F3, F14, F16, F17, F21: docs, comments, agent context |
| `7b3316c` | follow-up | whole-branch review: three binding-doc sentences, stale permutation comments, sanitizer hardening |

## Finding disposition

Every finding was re-verified against the working tree before any change;
none had been changed by other work since `373cf05`. "Plan" and "Diff" are
the Codex verdicts for the cluster the finding shipped in.

| F | Status | Root cause / reason | Files changed | Tests | Commit | Plan | Diff |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F1 | fixed | Category-branch planner excluded worn rows in pack mode only, on a false belief about List view (#135 after #110) | `src/lists/ListDetailPage.tsx` | `list-detail-reorder-planning.test.ts` +4 (fail-first: 3 of 4 failed unfixed) | `579d04b` | approve, narrow claims | mergeable as-is |
| F2 | fixed | Plugin stores the submitted casing; user row is lowercase; purge compared byte-for-byte | `server/repos/users.ts` (+3 comment corrections) | `auth-delete-user.test.ts` HTTP regression (fail-first: stale link redeemed 200) | `23f3556` | approve with INVALID_TOKEN assertion | mergeable as-is |
| F3 | blocked on external fact -> documented | Limits table links the count to subrequests; workerd's D1 binding sends a batch as one fetch. No production measurement exists. No code changed | `docs/incidents.md`, `AGENTS.md`, `server/repos/pack-reorder.ts` (comment) | - | `c011218` | n/a | mergeable (docs review) |
| F4 | fixed | Drizzle wrapper message + V8 stack header embed bound params; better-auth's default logger and better-call's fallback logged raw errors outside the ceiling | `server/middleware/error-handler.ts`, `server/auth.ts`, `server/index.ts`, `SECURITY.md` | `error-handler.node.test.ts` (new), `error-handler.test.ts` +2, `auth-error-logging.test.ts` (new, 4; fail-first: 3 failed unfixed) | `1bd7bb2`, hardened in `7b3316c` | needs changes (all adopted) | mergeable after adapter-sink regression (added) |
| F5 | fixed | Missing key selected the console sender on any origin | `server/email/index.ts`, `console.ts`, `env.d.ts`, `SECURITY.md` | `email/index.node.test.ts` (new), HTTP case in `auth-error-logging.test.ts` | `1bd7bb2` | sound | mergeable |
| F6 | accepted, documented | Day-count planning reads outside the batch; same class as the documented concurrent-food gap | `SECURITY.md`; plus `setDayCount` now classifies the list-deleted FK race | `constraint-races.test.ts` +1 | `4a8a567` | accept; alt. considered | mergeable |
| F7 | fixed | 0022 BEFORE UPDATE trigger fires ahead of the FK; marker unclassified | `server/repos/food.ts` | `constraint-races.test.ts` +1 (fail-first) | `4a8a567` | fix | mergeable |
| F8 | fixed | Response composed from pre-read + RETURNING | `server/repos/food.ts` (RETURNING all scalars; links SELECT inside the batch) | `constraint-races.test.ts` +1 (fail-first) | `4a8a567` | fix, batch the links read | mergeable |
| F9 | fixed | Gear-delete fan-out invalidated gear + list-items only | `src/lib/queries/gear-list-items-fan-out.ts`, `keys.ts` | `gear-list-items-fan-out.test.ts` +3 | `4a8a567` | fix, prefix families | mergeable |
| F10 | accepted, documented | Cross-table tie in a race window; cosmetic, dissolves on next reorder | `SECURITY.md`, `packing-locations.ts` (comment) | - | `4a8a567` | accept | mergeable |
| F11 | fixed | Epsilon decimal check | `shared/gear.ts`, `shared/decimal.ts` | `shared/gear-cost.test.ts` (new) | `4a8a567` | fix | mergeable |
| F12 | fixed | Optimistic placeholder unmounts the error owner | `src/lists/ListsEmptyState.tsx`, `docs/incidents.md` | `ListsEmptyState.test.tsx` (new; proves unmount-then-fail) | `4a8a567` | fix, uncertainty copy | mergeable |
| F13 | fixed | Null re-read passed out as 200 | `server/routes/food.ts` | `food-days-route.test.ts` (new; fail-first) | `4a8a567` | fix | mergeable |
| F14 | accepted, documented | 176 `checkJs` diagnostics, none a defect; self-tests already run first on every CI invocation; any change lands on the deploy gate | `docs/testing-and-ci.md` | - | `c011218` | accept, narrower rationale | mergeable |
| F15 | fixed (targeted) | Planners lived in the page; the worn rule was duplicated | `src/lists/list-reorder-plan.ts` (new), `section-rows.ts` (new), `ListDetailPage.tsx`, `CategoryGroup.tsx` | imports moved; `CategoryGroup.test.tsx` strengthened | `1be260e` | proceed, narrow | mergeable as-is |
| F16 | fixed | Docs and comments contradicted code | `SECURITY.md`, `.claude/skills/verify/SKILL.md`, `docs/testing-and-ci.md`, `AGENTS.md`, six portability comments, `pack-reorder.ts`, `gear-status.ts`, `takeout-files.ts`, `lists.ts` | - | `c011218`, `7b3316c` | n/a | mergeable after 5 corrections (made) |
| F17 | classified | `.planning/` is a 2026-07-19 tool snapshot | banners on four `.planning` files; `AGENTS.md` taxonomy | - | `c011218` | n/a | mergeable |
| F18 | fixed | Unreachable branch, duplicate `chunkIds`, six test-only helpers, duplicate payload type | `list-items.ts`, `food.ts`, `pack-reorder.ts`, `grouping.ts`, `optimistic.ts`, `gear-status.ts` (+ their tests) | 20 dedicated tests removed with their subjects | `54b89e6` | approve with corrections | mergeable as-is |
| F19 | fixed | Test grepped the source | `ListDetailPage.category-footers.test.tsx` (new); grep test deleted | page-render test | `6f2fc0a` | approve | mergeable after 4 (made) |
| F20 | fixed | Matrix cells without tests | `food.test.ts` +4, `lists.test.ts` +2, `packing-locations.test.ts` +1, `food-packing.test.ts` +2, `passkey-gate.test.ts` +1, `docs/authz-matrix.md` | 10 cells | `6f2fc0a` | approve with additions | mergeable after 4 (made) |
| F21 | recorded | Plan tier is not recorded in the repo; dated docs say Free | `docs/incidents.md` | - | `c011218` | n/a | mergeable |

## Additional findings (not in the audit)

Fixed in this branch, because they were exposed by the work or are the same
class as a finding being fixed:

- `setDayCount` could 500 on an unclassified FK when the list was deleted
  after its ownership check (Codex, cluster 4 plan review). Classified as
  not-found; regression added.
- Better-call's raw `console.error` fallback and better-auth's message-only
  SQL logging branch were additional F4 sinks (Codex, cluster 1 plan review).
  Closed by the `onAPIError` hook.
- Three more binding-document contradictions and five stale "permutation"
  comments (Codex, whole-branch review). Corrected in `7b3316c`.
- Sanitizer hardening: non-string messages were coerced with `String()`, error
  names were untruncated, and a hand-built stack could keep text after its
  header (Codex, adversarial review; synthetic shapes, no HTTP path found).
  Closed in `7b3316c`.

Recorded for later, not fixed (all P3):

- better-auth's adapter factory writes one raw `console.error(error)` when the
  second statement of a JS-side join fails (`@better-auth/core`
  `db/adapter/factory.mjs`). Outside the sanitizer and the ceiling; the value
  bound there is the user id, never the token. The installed Drizzle adapter
  has no native join to switch to. Stated in `SECURITY.md`; a test pins that
  the token stays out of it.
- A list-items fetch that is in flight when a gear delete starts, and resolves
  during it, is neither snapshotted nor invalidated (Codex, adversarial
  review; the fan-out file's KNOWN GAP comment already describes the class).
  The file's own suggested fix - invalidate the `list-items` prefix on delete
  settlement - is one line, left for a deliberate decision.
- The gear list-item update reads the gear row separately after its batch
  (`server/repos/list-items.ts` ~L478), the same cross-snapshot window F8
  closed for food (Codex, cluster 4 plan review).
- `git grep` still finds two `REWRITE_PLAN` references in comments that do
  not assert a live portability target (`app-schema.ts`, `rate-limit.ts`).
- The footer test reads a region's text with both responsive copies in it;
  it proves the page's wiring, not each responsive presentation.

## Validation

Full suite on `c011218` (all eight repository checks), then the subset
affected by the follow-up commit on `7b3316c`.

| Command | `c011218` | `7b3316c` |
| --- | --- | --- |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run lint` | exit 0 | exit 0 |
| `npm run test:unit` | 130 files / 1283 tests, exit 0 | see below |
| `npm run test:api` | 21 files / 305 tests, exit 0 | see below |
| `npm run build` | exit 0 | see below |
| `npm run check:yaml` | exit 0 | unchanged inputs |
| `npm run check:action-pins` | 6 verified, exit 0 | unchanged inputs |
| `npm run test:migrations` | 8 post-baseline migrations preserve seeded data, exit 0 | unchanged inputs |

Final subset on `7b3316c`:

```
== typecheck
exit 0
== lint
exit 0
== test:unit
 Test Files  130 passed (130)
      Tests  1284 passed (1284)
exit 0
== test:api
 Test Files  21 passed (21)
      Tests  305 passed (305)
exit 0
== build
✓ built in 156ms
✓ built in 243ms
exit 0
```

Unit-test count moved from 1264 (audit baseline) to 1303 at `1be260e` and
1283 after cluster 7 removed 20 tests along with the helpers they tested;
API tests from 284 to 305.

## Codex final review

- **Whole-branch review:** no runtime regression confirmed; no security or
  data-integrity regression; no unjustified hunk. One merge-blocking item:
  three binding-document sentences still contradicting the code - fixed in
  `7b3316c`. Non-blocking: the remaining permutation comments (fixed in
  `7b3316c`), the disclosed adapter sink, the footer test's responsive
  limitation, and that it did not itself reproduce the fail-first runs.
  It could not reach the Actions API from the sandbox; CI for this head has
  not been observed.
- **Adversarial review:** substantiated three P3 items, all listed above
  (pending-fetch cache gap: pre-existing; sanitizer shapes: closed; adapter
  sink: documented). Could not substantiate: dev-origin spoofing of the email
  gate, a missed or cross-account magic-link purge, a List-view drag that
  plans over a hidden row or refuses a legitimate one (8,192 in-memory
  planner cases), a food PATCH read-back mismatch, an invalidation storm, a
  wrong-reason authorization pass, a surviving consumer of a removed symbol,
  or an overclaiming documentation sentence.
- **Rejected Codex findings (reasoned disagreement):** enabling native joins
  to close the adapter sink (the installed adapter has none); `onConflictDoNothing`
  for F6 (partial, and the class is documented as accepted); moving the
  harness self-tests under vitest (marginal benefit against the deploy gate).
- **Unresolved external facts:** the D1 per-invocation count has
  documentation-plus-source evidence, not a production measurement; the
  Workers plan tier is an operating assumption.
- **Residual risks:** the adapter's raw line; the in-flight list-items fetch;
  the untyped migration harness (accepted).

## Diff assessment

Remediation stayed targeted: 64 files, +2523 / -756 before the follow-up,
dominated by tests (about two thirds of the additions) and documentation. No
cluster materially expanded beyond its finding. The two places scope grew
were deliberate and reviewed: cluster 1 took on the better-call fallback
and the `onAPIError` hook because F4 could not be closed without them, and
cluster 5 added the passkey ownership cells and a non-owner document-reorder
case because the matrix rule required them once re-derived.

## Audit relationship

The audit file is unchanged and records `373cf05`. This report records what
changed afterwards. Where the two disagree about the current code, this
report and the binding documents are current; the audit is history.
