# Phase 20 — REVIEW-performance.md closure (2026-05-06)

> **Status (locked):** spec for Codex review. Do not execute until the user gives the go-ahead.

## Goal

Close `REVIEW-performance.md` as a campaign artifact. The audit dates to 2026-05-04 with 24 findings (H1–H6, M1–M13, L1–L9 with gaps). Phases 1–8 already shipped the substantive work; Phase 8's wrap-up at `REVIEW-FIX.md:309` declared the audit "substantially closed". Phase 20's job is (a) finish the one verification that Phase 7 deferred — M13 (lucide-react tree-shaking), (b) document any remaining audit-stale or speculative items as deferred, (c) write the closure summary in `REVIEW-FIX.md` so the campaign deck is empty.

## Why this phase is small

`REVIEW-FIX.md:309` (Phase 8 summary):

> After Phase 8, REVIEW-performance.md is substantially closed: H1–H6 done, M1–M13 done (M2 + M3 closed by this phase), L1–L9 done or audit-stale dropped. Remaining perf items would be backend/infrastructure (Cloudflare cache headers, etc.) or speculative (sub-millisecond memo wins) — neither warrants a dedicated phase.

The one finding that didn't reach a definitive verdict was M13 — `lucide-react` tree-shaking. Phase 7 closed it as "probable pass, full verification deferred" because a single bundle-size number isn't a complete proof under a multi-chunk topology. Phase 20 finishes that verification with a tighter approach: bundle-size budget math + per-import audit. Everything else is closure paperwork.

---

## Audit-stale closures (audit-side reference)

Each finding below is verified against the campaign ledger. No new commit needed for any of these.

### High severity

| Finding | Where closed | Commit |
|---|---|---|
| **H1** Missing indexes on `list_items` | Phase 6 | `9482882` (migration `20260509000000_list_items_and_lists_indexes.sql`). Shipped three indexes that deviate from the audit's recommendation while covering the same query plans — and one extra: `list_items_user_list_sort_idx` (composite over `user_id, list_id, sort_order` — covers the authed `fetchListItems` path with no extra sort step), `list_items_list_sort_idx` (composite over `list_id, sort_order` — covers the anon share-view path which has no `user_id` predicate, plus the `lists.id → list_items.list_id` cascade and `resetPackedForList`), and `list_items_gear_item_id_idx` (covers the `gear_items.id → list_items.gear_item_id` cascade). The migration's per-index comment block explains why this shape is preferred over the audit's looser `(list_id, sort_order) + (user_id) + (gear_item_id)` triplet. The audit's `list_items_user_id_idx` was deliberately not created — it would have been a strict prefix of `list_items_user_list_sort_idx` and added no planner options the composite doesn't already provide. |
| **H2** Gear edits broadcast `['list-items']` invalidation | Phase 2 | `4ebcc07` (per-cache narrowing at both call sites) |
| **H3** `bulkDelete` / `bulkMove` non-optimistic | Phase 2 | `00c41d7` (helpers), `935ed1b` (rewire) |
| **H4** `react-markdown` in main bundle | Phase 3 | `b33b144` (-46.53 KB gzip) |
| **H5** `vaul` in main bundle | Phase 4 | `88041c0` (-18.69 KB gzip; needed M11's JS viewport gate to land first) |
| **H6** `fflate` in main bundle | Phase 3 | `8dcdcbb` (-4.54 KB gzip) |

### Medium severity

| Finding | Where closed | Commit |
|---|---|---|
| **M1** Missing index on `lists.user_id` | Phase 6 | `9482882` (`lists_user_sort_idx` covering `user_id`, `sort_order`, `name`) |
| **M2** `addNewItemMut` two RTT | Phase 8 | `ab98d7f` (single RPC call) |
| **M3** `duplicateList` / `createListFromSelection` 2-3 RTT | Phase 8 | `c95c3d5` (createListFromSelection), `dfb8fac` (duplicateList) |
| **M4** `RootRedirect` cold-load block | Phase 7 | `6c2da5a` (last-list-id localStorage cache + cold-path fallback + self-heal on poisoned cache) |
| **M6** Grouping helpers O(C×I) | Phase 5 | `6491c7c` (single-pass bucket map; structural-stability invariants) |
| **M7** `LibraryPanel` filter+group memo | Phase 4 | `db98e75` |
| **M8** `sharedGroupProps` deps churn | Phase 4 | `560a5a8` (refs + smaller dep array) |
| **M9** `formatRelativeDate` ticks | Phase 7 | `3068e91` (`useNow(60_000)` page-level hook) |
| **M10** `usePortalPopover` deps | Phase 1 | `5cafad7` (`[onClose]` deps; ~800 effects/render eliminated) |
| **M11** ItemRow / GearItemRow mount both branches | Phase 4 | `d8c1032` (`useIsBelowLg` + `useIsMobile` JS gates) |
| **M12** `CategoryGroup` not memoized | Phase 4 | `db98e75` (`React.memo` + stable callback API change) |
| **M13** `lucide-react` tree-shaking | **active in Phase 20** (see C1 below) — closed in Phase 7 as "probable pass, deferred verification"; Phase 20 finishes the rigorous check |

### Low severity

| Finding | Where closed | Commit |
|---|---|---|
| **L1** `WeightTable` recomputed each render | Phase 5 | `bf59093` (memoized; signature-corrected by Codex) |
| **L2** `SharePage.categoryIds` not memoized | Phase 5 | `545327b` |
| **L3-L4** Drag handler / collision-detection memo | Phase 7 | DROPPED — audit-stale (collisionDetection already memoized at `GearLibraryPage.tsx:398`; drag handlers aren't props to memoized children) |
| **L7** Routes not code-split | Phase 3 | `4e77846` (auth + Share routes split, -5.04 KB gzip) |
| **L9** `formatPurchaseDate` Intl per call | Phase 7 | `10fed9a` (hoisted `DATE_FORMATTER`) |

The audit numbering skips L5, L6, L8 — those don't exist.

---

## Active commit

### C1 — M13 verification: lucide-react tree-shaking

**Why this commit exists:** Phase 7's M13 closure read "probable pass, full verification deferred" because a single bundle-size number isn't a complete proof under a multi-chunk topology. Phase 20's job is to finish that verification rigorously enough that closing `REVIEW-performance.md` doesn't leave a "probable pass" hanging in the ledger.

**Outcome branches:** This commit has two possible shapes depending on what the verification finds. Both branches are spec'd here so execution doesn't stall on the surprise. The verification runs first; the second commit (if any) follows.

#### Step 1 — Run the verification (no commit)

Three checks in sequence. Stop at the first one that produces a definitive verdict.

**Check A — Per-import audit (cheap, quick).** Confirm every `lucide-react` import in `src/` uses named imports of specific icon components, never wildcard or default. A wildcard import (`import * as Icons from 'lucide-react'`) defeats tree-shaking regardless of bundler config; named imports are the precondition for tree-shaking to work at all.

```bash
# Expected: 26 lines, all of the form:
#   import { IconA, IconB, ... } from 'lucide-react'
# Should NOT see:
#   import * as ... from 'lucide-react'
#   import Icons from 'lucide-react'
grep -rE "from ['\"]lucide-react['\"]" src/ | grep -v "^Binary"
```

Pass criterion: every line is a named-imports form. Fail criterion: any wildcard or default import — switch to per-icon paths is the fix.

**Check B — Total-JS-payload budget math (definitive if numbers diverge enough).** Phase 7 deferred this finding because "a single bundle-size number isn't a complete proof under a multi-chunk topology." Check B addresses that head-on: measure the total JS gzip across **every** built chunk in `dist/assets/`, not just `index-*.js`. If lucide is misshipped, the icons can land in any of the lazy chunks (`MarkdownPage-*`, `ListSelectorDrawer-*`, `ListSidebarDrawer-*`, the auth-page chunks, `SharePage-*`, `dist-*`, `browser-*`, `tslib.es6-*`, `jsx-runtime-*`) — so the budget math has to be applied to the sum.

`lucide-react` ships 1952 icon entries in `node_modules/lucide-react/dist/esm/icons/` (verified this session: `ls node_modules/lucide-react/dist/esm/icons | wc -l` returns 3904 — that's icons + sourcemaps, so 1952 distinct icons). Each icon's source `.mjs` is on the order of 500–800 bytes (SVG path data).

If tree-shaking failed and all 1952 icons were bundled (somewhere — main, an async chunk, or duplicated across chunks):

- Raw cost: ~1952 × ~600 bytes ≈ 1.17 MB
- Gzipped cost (typical 5x compression on similar SVG/JS): **~200–300 KB *added* to the total JS gzip** on top of everything else.

After Phase 19's commits, the **total** JS gzip across all chunks (main + lazy chunks + the small dist/jsx-runtime/browser/tslib chunks) sits well below the floor where a misshipped lucide would land. Record the actual number during execution by summing gzipped sizes from `npm run build`'s reporter output (or recomputing them with `gzip -c <file> | wc -c` if the reporter changes format).

Run command:

```bash
npm run build 2>&1 | tee /tmp/build-output.txt
# Then sum:
total=$(awk '/dist\/assets\/.*\.js/ { match($0, /([0-9.]+) kB \│ gzip:[ ]*([0-9.]+) kB/, m); if (m[2]) sum += m[2] } END { print sum }' /tmp/build-output.txt)
echo "Total JS gzip across all chunks: ${total} KB"
```

(If `awk`'s match-array form isn't portable on the local mac, fall back to `grep -E "dist/assets/.*\.js" /tmp/build-output.txt` and parse manually — the exact awk syntax is illustrative, not load-bearing for the spec. The output to record is the sum.)

**Pass criterion (both must hold):**

1. Total JS gzip across all chunks < 350 KB. (Threshold chosen because the current total is on the order of 220–230 KB gzip — main 187.83 KB plus the lazy chunks visible in `ls -la dist/assets/` are each in the 1–46 KB gzip range — and the floor where "all 1952 icons bundled somewhere" would force us is well above 400 KB. 350 KB gives generous slack for legitimate growth without straying near the failure floor.)
2. The 36 distinct named icons in `src/` (per Check A's grep) is the maximum count we'd see if tree-shaking is working perfectly; if Check B's number drifted into the 350+ KB band we'd suspect a regression and escalate.

**Fail criterion:** total JS gzip across all chunks ≥ 450 KB. That would be a strong signal that tree-shaking failed (or another major regression landed). If the total lands in the gray zone (350–449 KB), escalate to Check C.

**What to record in the Phase 20 summary:**

- Main bundle gzip (`index-*.js`) — for continuity with prior phase summaries that named this number.
- Total JS gzip across all chunks — the load-bearing number for M13's closure.
- Per-chunk breakdown (one line per `dist/assets/*.js`) — so a future reader can audit the math.

**Check C — `vite-bundle-visualizer` (rigorous, requires one-time install).** Only run if Checks A and B don't reach a verdict (i.e., total JS gzip lands in the 350–449 KB gray zone). Adds the `rollup-plugin-visualizer` dev dependency, runs a build with the plugin enabled, opens the resulting treemap, and counts the lucide footprint precisely. The treemap shows lucide's contribution per chunk — definitive whether or not tree-shaking is working.

Skip Check C if Check B's number is unambiguously below 350 KB (it almost certainly will be).

#### Step 2 — Document the closure (no commit; updates Phase 20 summary inline)

Write the verification result into the Phase 20 summary in `REVIEW-FIX.md` (the closure-paperwork commit at the end of this phase). The summary names the actual numbers observed: main bundle gzip (continuity with prior phase summaries), total JS gzip across all chunks (load-bearing for M13's closure), per-chunk breakdown (one line per `dist/assets/*.js` so future auditors can recompute the math), distinct lucide icons in `src/`, and the conclusion. No code change if Check A or Check B passed.

#### Step 3 (conditional) — If verification fails, switch to per-icon imports

This branch only fires if Check A or B reveals a real tree-shaking failure. The fix is mechanical: replace named imports with per-icon paths.

```ts
// Before (relies on tree-shaking):
import { Search, X, Plus } from 'lucide-react'

// After (guarantees tree-shaking; one path per icon):
import Search from 'lucide-react/dist/esm/icons/search.mjs'
import X from 'lucide-react/dist/esm/icons/x.mjs'
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
```

Touches 26 files. Per-icon paths require pascal→kebab-case conversion (`ChevronDown` → `chevron-down`). Verification: re-run `npm run build`; main bundle gzip should drop measurably (the actual delta tells us the failure scale).

**This branch is not expected to fire.** It's spec'd so execution doesn't stall on the (unlikely) discovery.

#### Acceptance for C1 (verification path)

- Check A passes: every lucide import in `src/` is a named-imports form.
- Check B passes: total JS gzip across all `dist/assets/*.js` chunks < 350 KB after a clean build (the load-bearing M13 criterion). Main bundle gzip is recorded alongside it for continuity with prior phase summaries, but is not the closure number on its own — this is the multi-chunk fix Phase 7 asked for.
- The Phase 20 summary in `REVIEW-FIX.md` records both numbers (main + total) plus the per-chunk breakdown and the conclusion.
- `git diff` shows no source-code changes (only the summary append, in the next commit).

#### Acceptance for C1 (fallback path, only if verification fails)

- All 26 import sites converted to per-icon paths.
- `npm run build` passes; main bundle gzip drops measurably from 187.83 KB.
- `npm run lint` passes (the per-icon path imports are still valid TypeScript with the package's exports map).
- `npm test --run` — full suite green.
- Single commit per logical change: one big mechanical rewrite, named appropriately.

---

## C2 — Phase 20 closure summary in REVIEW-FIX.md

After C1 (verification only, or verification + fallback), append a Phase 20 summary to `REVIEW-FIX.md` matching the format of Phase 19's summary. Sections:

- **Shipped** — C1 (M13 verification) only if the verification passed; or C1 + the per-icon import rewrite if it didn't.
- **Audit closures** — list all 24 findings closed across the campaign (this spec already has the table; reuse the structure).
- **Deferred** — `vite-bundle-visualizer`-grade verification on every dependency (deferred indefinitely; Check B math is sufficient for the audit's question). Cloudflare cache-header tuning (deferred; not in `REVIEW-performance.md` scope). Speculative sub-millisecond memo wins (out of scope).
- **Verification results** — `npm run build`, `npm run lint`, `npm test --run` all pass. Actual numbers from Check B (bundle gzip).
- **Campaign milestone** — `REVIEW-performance.md` closed. The full review campaign (`REVIEW-quality.md` Phase 17, `REVIEW-security.md` Phase 19, `REVIEW-performance.md` Phase 20) is closed. The campaign deck is empty.
- **Next phase** — none. Open question for the user: what's next? (Phase 18's deferred test items? Specific feature work? Backend infrastructure?)

**Commit message for C2:**

```
docs(review-fix): append Phase 20 summary

Closes REVIEW-performance.md as a campaign artifact. Phase 7's M13
"probable pass" verdict upgraded to a definitive pass via per-import
audit (every lucide import is named-imports form) and total-JS-gzip
budget math summed across every chunk in dist/assets/ (not just
main, because lucide misshipped into a lazy chunk would still need
to fit somewhere). Recorded numbers in the summary; the full lucide
set would add 200-300 KB gzip on top of everything else, and the
measured total sits well below that ceiling.

All three review campaigns are now closed:
- REVIEW-quality.md      → Phase 17
- REVIEW-security.md     → Phase 19
- REVIEW-performance.md  → Phase 20

Two campaign-side deferrals stay in the deck:
- F4 full path (security; SECURITY DEFINER fetch_shared_list)
- Server-side recent-auth on delete_account() (security; documented
  in SECURITY.md "Accepted residual risks")

Performance deferrals are speculative or out-of-scope (Cloudflare
cache-header tuning, sub-millisecond memo wins).
```

---

## Deferred (stays in the campaign deck)

- **`vite-bundle-visualizer`-grade verification** of every dependency. Treemap-precise inspection is overkill for the audit's "is tree-shaking working?" question; bundle-size budget math is the right level of rigor for a single-finding closure. Stays available if a future regression triggers a deeper investigation.
- **Cloudflare cache-header tuning** — out of `REVIEW-performance.md` scope (audit's "Confirmed strengths" already noted the SW cache strategy is correct).
- **Speculative memo wins** — sub-millisecond render-perf cleanups beyond what M6/M7/M8/M11/M12 already shipped. Not in the audit; not in scope.

---

## Out of scope

- Switching to per-icon `lucide-react` imports preemptively. Only do this if Check B's math fails. Mechanical rewrite of 26 files isn't worth doing for a finding the math already closes.
- Re-running prior phase verifications. Each prior phase's summary records its own gates passing; no need to re-prove them now.

---

## Verification gates

After C1 (verification path):

- `npm run build` — pass; main bundle gzip AND total-JS-gzip-across-all-chunks recorded for the summary.
- `npm run lint` — pass (no source change in the verification path).
- `npm test --run` — full suite green (no source change).
- `grep -rE "from ['\"]lucide-react['\"]" src/ | grep -cE "^[^:]+:import \{" ` — returns 26 (every site uses named-imports form).
- **Total JS gzip across all chunks < 350 KB** (the load-bearing M13 closure number — main + every lazy chunk under `dist/assets/*.js`).
- No single chunk's gzip is suspiciously large (flag if any one chunk balloons unexpectedly relative to its prior phase baseline).

After C1 (fallback path, only if verification fails):

- All 26 import sites converted; no `from 'lucide-react'` lines remain that aren't per-icon paths.
- `npm run build` — pass; main bundle gzip dropped measurably.
- `npm run lint` — pass.
- `npm test --run` — full suite green.

After C2:

- `git log --oneline` shows the verification commit (or commits, if fallback fired) followed by the summary commit.
- `REVIEW-FIX.md` contains the Phase 20 summary section with the actual measured bundle size.

---

## Risk register

- **Risk:** Check B's math is wrong, OR misses lucide payload that landed in a lazy chunk rather than `index-*.js`. Mitigation: Check B now sums gzip across **every** chunk in `dist/assets/*.js`, not just main — so lucide misshipped into `MarkdownPage-*` or `SharePage-*` or any other lazy chunk would still hit the budget. The math has 100+ KB of slack on each side of the threshold (current total ~220–230 KB gzip vs. 350 KB pass threshold vs. 450+ KB fail floor under tree-shaking failure). The threshold doesn't depend on a precise estimate of lucide's per-icon size — it depends only on the gross fact that 1952 icons can't fit in <130 KB gzip *anywhere* on top of React + Supabase + dnd-kit + app code distributed across chunks. If Check B's total lands in the 350–449 KB gray zone, Check C escalates to a treemap-precise audit.
- **Risk:** I miss a wildcard import in `src/`. Mitigation: the grep in Check A is the rigorous check; if any `import *` from lucide-react existed, that grep would surface it.
- **Risk:** the fallback path (per-icon imports) runs but breaks the build because lucide-react's exports map doesn't allow deep-path imports. Mitigation: the package ships `dist/esm/icons/*.mjs` directly; the path is real and stable. Verified this session: `ls node_modules/lucide-react/dist/esm/icons/search.mjs` returns the file. The `.mjs` extension is required (not `.js`).
- **Risk:** Codex finds an audit-stale finding I missed in the closure tables. Mitigation: every entry above cites a commit ref or "DROPPED" reason from `REVIEW-FIX.md`; pre-execution, this spec is a fixed target Codex can audit against.
- **Risk:** the closure summary feels anticlimactic ("we just confirmed nothing was broken"). Mitigation: that's the honest outcome, and the summary frames it correctly. The campaign's value is the 19 prior phases of substantive work; Phase 20 is the cap.

---

## Pre-execution checklist

- [ ] User has approved this spec.
- [ ] Codex review of this spec is complete and any findings have been patched into this file.
- [ ] No staged or unstaged changes outside this file.
- [ ] Working from `main` with the recent Phase 19 commits (a7ba8b5, ffa9efc, 6078d34) verified.
