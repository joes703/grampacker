# grampacker - Synthesized Codebase Audit Report

> Generated 2026-06-06, read-only audit, scope = full working tree (merged draft-status feature + uncommitted supply-chain hardening), nothing modified.

Synthesis of seven parallel audit tracks (behavioral, duplication, drift, dead-code, language, security, tests). Findings deduplicated across tracks, challenged against a quality bar, re-severitized by actual impact, and ranked. Highest-impact behavioral claims were spot-checked against the live code before being blessed.

---

## 1. Executive summary

The codebase is **healthy**. Build is green (`tsc -b && vite build`), the test suite passes (379 passed / 4 skipped, the 4 being credential-gated integration tests), the RLS model and public-projection boundary are sound, and there are no XSS surfaces or active vulnerabilities. Zero critical, zero high-security findings. The seven tracks surfaced **no data-corruption bugs and no privacy leaks**. What they surfaced is concentrated in three systemic themes:

1. **Silent mutation-failure policy has real gaps at the non-optimistic call sites.** The project's documented policy is "optimistic snap-back IS the error signal." That policy is sound for optimistic mutations, but four user-triggered actions are **non-optimistic** (create-list-from-selection, quick-add-item, duplicate-list, reset-packed/ready) and therefore have *no* snap-back to serve as a signal. They fail with no toast, no dialog, and in the reset case an unhandled promise rejection. These are the only confirmed user-facing defects, and they share one root cause: the policy was applied uniformly without distinguishing optimistic from non-optimistic paths. (C-01..C-04.)

2. **Two god-files (`ListDetailPage.tsx` ~1300 lines, `GearLibraryPage.tsx` ~900 lines) concentrate hand-rolled, untested within-category DnD plus duplicated list mutations.** The within-category reorder algebra is duplicated across both files, is structurally fragile (the same-tick `useQuery` colocation rule is *narrated*, not *enforced*), and has **zero tests for the slice algebra** despite being pure logic that needs no dnd-kit to test. This is the single largest maintenance risk. (C-05, C-13, M-tests.)

3. **Documentation drift in the security allowlist and spec.** `SECURITY.md`'s public-read allowlist is stale on three of four tables (missing `group_worn`, `is_draft`, `cost`, `purchase_date`, `status`, `is_ready` in the right columns/exclusion lists). The code and the `shared-projections.test.ts` lock are *correct*; only the doc is wrong. No leak - but the security reference doc is the early-warning mechanism, and a doc that's already wrong is one reviewers learn to distrust. The same drift class hits SPEC.md (CSV "10 columns" vs actual 12) and a CLAUDE.md supply-chain warning that now contradicts the committed `.npmrc`. (C-06..C-10.)

Everything else is constant-extraction hygiene, dead back-compat aliases, and copy polish - low-risk, mostly mechanical, and safe to batch.

---

## 2. Confirmed findings

Ordered by severity, then confidence. Corroborating tracks noted. "Safe for autonomous repair" reflects whether a fix needs a human decision (copy wording, UX design, new migration) vs. mechanical.

---

### C-01 - `resetPacked` / `resetReady` throw on server failure with no user feedback (unhandled rejection)
- **Severity:** Medium (track-1 said high; downgraded - see note)
- **Confidence:** High (code-verified)
- **file:line:** `src/lists/ListDetailPage.tsx:670-734`; call sites `src/lists/PackingProgress.tsx:203,215`
- **Evidence:** Both are `async` functions that run a field-scoped cache rollback then `throw err` (lines 701, 728). `PackingProgress` invokes them as `onReset()` / `readyChecks.onResetReady()` with no `await` and no `.catch()`; prop type is `() => void`. On a server PATCH failure the rollback runs (items snap back correctly) but the thrown error becomes an unhandled promise rejection with no toast/dialog.
- **Call chain / conflict:** `ConfirmDialog.onConfirm` -> `onReset()` -> `resetPacked()` (throws) -> unhandled rejection. Not a `useMutation` path, so the global `mutationErrorHandler` never sees it. Contradicts the SPEC "silent rollback" policy intent: that policy is justified for optimistic snap-back where the snap-back IS the signal - here the snap-back happens but with zero explanation, and the rejection is genuinely unhandled.
- **Impact:** User taps "Reset packing" / "Reset ready"; on failure items snap back with no message; console gets an unhandled rejection that could trip future error monitoring. No data corruption (rollback is correct and field-scoped).
- **Why downgraded from high:** Both functions have an offline guard (`!navigator.onLine` early-return, lines 675/714) AND PackingProgress disables the button offline, so the only live failure window is a server-side 5xx on an online client - narrow. No data integrity impact. Real but not high.
- **Recommended correction:** A toast-then-`throw` is WRONG - it still leaves a fire-and-forget rejected promise (the call sites at `PackingProgress.tsx:203,215` invoke `onReset()`/`onResetReady()` un-awaited with no `.catch`). Pick ONE of: **(a, preferred)** roll back, `showToast("Couldn't reset packed items. Please try again.", { type: 'error' })`, and **consume** the error (delete `throw err`) - keeps the `() => void` contract and removes the rejection; or **(b)** change `onReset`/`onResetReady` to `() => Promise<void>` and explicitly `await`+`catch` at both `PackingProgress` call sites. Do NOT leave a rejected promise unhandled.
- **Tests needed:** A failed `resetPackedForList` produces a toast and restores `is_packed` on the cleared ids only.
- **Safe for autonomous repair:** yes
- **Corroborating tracks:** 1 (F-3).

---

### C-02 - `createListFromSelectionMut` has no `onError` - silent failure, dialog stays open with no feedback
- **Severity:** Medium
- **Confidence:** High (code-verified)
- **file:line:** `src/gear/GearLibraryPage.tsx:383-393`
- **Evidence:** The mutation has `onSuccess` only; no `onError`. The sibling `importItems` mutation immediately below (lines 395+) has explicit `import-error` dialog routing - the asymmetry is right there in the same file.
- **Call chain / conflict:** `CreateListFromSelectionDialog.onSubmit` -> `createListFromSelectionMut.mutate` -> `createListFromSelection` (atomic RPC with slug retry). On rejection, `isPending` returns to false, dialog stays open, nothing shown. Global handler only `console.warn`s.
- **Impact:** "Create list from N items" spinner stops, dialog stays open with no error. No partial commit (RPC is atomic), so the harm is pure confusion + retry loops.
- **Recommended correction:** Add `onError: (err) => setDialog({ type: 'import-error', message: err instanceof Error ? err.message : "Couldn't create the list. Please try again." })`, mirroring `importItems`.
- **Tests needed:** Rejected `createListFromSelection` -> visible error feedback.
- **Safe for autonomous repair:** yes
- **Corroborating tracks:** 1 (F-2).

---

### C-03 - `addNewItemMut` (Quick Add) has no `onError` - silent failure on non-optimistic item add
- **Severity:** Medium
- **Confidence:** High
- **file:line:** `src/lists/ListDetailPage.tsx:565-590`
- **Evidence:** `useMutation` over `supabase.rpc('add_gear_item_with_list_item', ...)` with `onSuccess` invalidation only, no `onError`. This is a *non-optimistic* insert (it waits for the RPC), so the SPEC snap-back justification does not apply - there is nothing to snap back.
- **Call chain / conflict:** `CategoryGroup` "+ Add new item" -> `onAddNewItem` -> `addNewItemMut.mutate`. On failure (cap trigger, RLS, network) the user sees nothing.
- **Impact:** User types an item, presses Enter, RPC fails, no feedback. May re-add or assume saved.
- **Recommended correction:** `onError: () => showToast("Couldn't add that item. Please try again.", { type: 'error' })`.
- **Tests needed:** Rejected RPC -> toast.
- **Safe for autonomous repair:** yes
- **Corroborating tracks:** 1 (F-4).

---

### C-04 - `duplicateMut` has no `onError` - silent failure on list duplicate
- **Severity:** Medium
- **Confidence:** High
- **file:line:** `src/lists/use-current-list-actions.ts:71-82`
- **Evidence:** `onSuccess` (invalidate + navigate) only, no `onError`. Non-optimistic (no optimistic write), so no snap-back signal.
- **Call chain / conflict:** List kebab "Duplicate" -> `duplicateMut.mutate(list)` -> `duplicateList` RPC. On failure: no navigation, no invalidation, no feedback.
- **Impact:** User clicks Duplicate, nothing happens, no error.
- **Recommended correction:** `onError: () => showToast("Couldn't duplicate that list. Please try again.", { type: 'error' })`.
- **Tests needed:** Rejected `duplicateList` -> toast.
- **Safe for autonomous repair:** yes
- **Corroborating tracks:** 1 (F-5).

> **Systemic note for C-01..C-04 + C-21 (exportCsv):** these six are one finding class - *non-optimistic user actions lack failure feedback because the codebase's "silent rollback" policy was applied without carving out the no-snap-back paths.* Fix as a single batch (Stage 6) and codify the explicit convention (added to `CLAUDE.md`):
> - **Optimistic mutation with a visible rollback:** the rollback may itself be the failure signal (no toast required - this is the documented existing policy; do NOT add toasts to these).
> - **Non-optimistic mutation or async action:** MUST provide explicit failure feedback (a toast or an error dialog).
> - **Fire-and-forget rejected promises are prohibited:** an async handler invoked without `await`/`.catch` must not be able to reject - it must catch internally and surface feedback, or its contract must become `Promise<void>` and be awaited+caught at the call site.

---

### C-21 - `exportCsv` is a fire-and-forget async with no catch - silent failure on export
- **Severity:** Medium
- **Confidence:** High (code-verified 2026-06-06)
- **file:line:** `src/lists/use-current-list-actions.ts:91-110`; call sites `src/lists/ListsPage.tsx:284`, `src/lists/ListSettingsPanel.tsx:170`, `src/lists/DesktopListsPanel.tsx:374`
- **Evidence:** `exportCsv` is an `async` `useCallback` that `await`s `Promise.all([qc.fetchQuery(listItems), qc.fetchQuery(categories)])` then `downloadCsv(...)`, with NO try/catch. All three call sites invoke it as `() => exportCsv(list)` - the returned promise is discarded (un-awaited, no `.catch`).
- **Call chain / conflict:** List kebab "Export CSV" -> `onExport` -> `() => exportCsv(list)`. If either `fetchQuery` rejects (offline / network / RLS), the promise rejects unhandled and the user sees nothing download with no error.
- **Impact:** Export silently does nothing on fetch failure; unhandled rejection in console. No data impact.
- **Recommended correction:** Wrap the body in try/catch, `showToast("Couldn't export the list. Please try again.", { type: 'error' })` on failure, and consume the error (no rethrow) so the fire-and-forget call sites cannot reject. Keeps the `(list) => void`-ish contract.
- **Tests needed:** A rejected `fetchQuery` -> toast, and `downloadCsv` not called.
- **Safe for autonomous repair:** yes
- **Corroborating tracks:** 1 (NI-3, promoted).

---

### C-05 - List-import partial commit leaves orphan list (+ categories/gear) on late insert failure
- **Severity:** Medium (track-1 said high; downgraded - see note)
- **Confidence:** High (code-verified)
- **file:line:** `src/lists/ListsPage.tsx:175-196` (`importMut`), `src/lib/queries/list-items.ts:247-284` (`importCsvRowsToList`)
- **Evidence:** `importMut.mutationFn` runs `assertListImportWithinCaps` (preflight), then `createList` (commits list row), then `importCsvRowsToList`, which itself sequentially commits categories (`resolveOrCreateCategories`, line 254), then gear (`resolveOrCreateGearForImport`, line 255), then the `list_items` bulk insert (line ~284). No transaction spans the four writes. If the `list_items` insert throws *after* the cap preflight passed (FK staleness, network drop, trigger), the list row + new categories + new gear remain committed; `onError` shows the import-error dialog but the orphan list later appears empty in the user's list view.
- **Call chain / conflict:** Contrast `createListFromSelection`, which uses a single atomic RPC (`create_list_from_selection`) and has no orphan path. The CSV import path is the asymmetric one.
- **Impact:** A failed CSV import can leave an empty list (and spurious inventory gear, NI-5) visible. Re-import with same name creates a second empty list. Dedup prevents gear multiplication on retry. No silent data *loss*.
- **Why downgraded from high:** The cap preflight already eliminates the most common failure (over-cap) before any write. The remaining trigger window is a late network/FK/trigger failure on the final insert - narrow. Impact is orphan clutter, not corruption or loss.
- **DECISION (2026-06-06, owner): atomic Postgres RPC.** Client-side `onError` cleanup is rejected - it is best-effort, can itself fail after a network interruption, and deleting the list would not reliably remove the newly created categories or inventory gear. Wrap the whole import in a single `SECURITY INVOKER` RPC modeled on `create_list_from_selection` (slug-retry, inline `auth.uid()` ownership check, RLS-gated writes) so a failure leaves NO new list, categories, gear items, or list items. Must preserve existing dedup (`resolveOrCreateGearForImport` key = `category_id + lower(name) + weight_grams`), the per-user caps, ownership, RLS/security, and slug-retry semantics.
- **Tests needed:** Integration test that forces a LATE failure (e.g. fail the final `list_items` insert after categories+gear committed) and compares **all affected table counts/state before and after** - `lists`, `categories`, `gear_items`, `list_items` must each be unchanged. Not merely "the list was removed."
- **Safe for autonomous repair:** no - requires a new migration (RPC) and transaction semantics. **Decision is now made (RPC); implement in Stage 10 (NOT part of Stage 6).**
- **Corroborating tracks:** 1 (F-1, NI-5). Related to dup C-13 (the duplicated `importMut` means this orphan bug exists in 3 copies - see Overlapping Systems map row 2).

---

### C-06 - `SECURITY.md` public allowlist stale for `lists` (`fetchSharedList`) - missing `group_worn`, `is_draft`
- **Severity:** Medium
- **Confidence:** High (doc, code, and test all verified verbatim)
- **file:line:** `SECURITY.md:92` vs `src/lib/queries/lists.ts:83` (`.select('id, name, description, group_worn, is_draft')`) vs `src/lib/queries/shared-projections.test.ts` (locks the exact 5-col string)
- **Evidence:** Doc claims `fetchSharedList` returns only `id, name, description`. Code + type (`PublicList`) + test agree on 5 columns. `group_worn` (migration `20260513000000`) and `is_draft` (migration `20260606063050`) were added to the share view after the doc line was written and never reflected.
- **Impact:** No leak - both fields are intentionally public. But `SECURITY.md` is the canonical "what anon can see" reference and is wrong; a future access review would be misinformed.
- **Recommended correction:** Update line 92 to list all 5 included columns; move `slug`, `is_shared`, `sort_order`, `ready_checks_enabled`, timestamps to Excluded with the rationale that `group_worn`/`is_draft` are deliberately public.
- **Tests needed:** None - test already locks the string.
- **Safe for autonomous repair:** yes (doc-only).
- **Corroborating tracks:** 3 (F-1), 6 (F1) - same root, merged.

---

### C-07 - `SECURITY.md` `gear_items` public exclusion list omits `cost`, `purchase_date`, `status`
- **Severity:** Low (track-3 said medium; the columns ARE correctly excluded in code/test - only the doc's *exclusion enumeration* is incomplete, which is lower impact than a missing inclusion)
- **Confidence:** High
- **file:line:** `SECURITY.md:94`; columns added by migrations `20260508000000` (cost/purchase_date) and `20260516000000` (status); `shared-projections.test.ts` asserts all three forbidden.
- **Evidence:** `GEAR_ITEM_PUBLIC_SELECT` correctly omits them; the test's forbidden list (`['cost','purchase_date','status','is_ready','user_id','sort_order']`) enforces it. The doc's Excluded enumeration just doesn't name them.
- **Impact:** Doc incompleteness only. Code/test correct.
- **Recommended correction:** Add `cost`, `purchase_date`, `status` to the `gear_items` Excluded list at line 94.
- **Safe for autonomous repair:** yes (doc-only).
- **Corroborating tracks:** 3 (F-2), 6 (verified-correct list).

---

### C-08 - `SECURITY.md` `list_items` exclusion list omits `is_ready` (and `user_id`)
- **Severity:** Low
- **Confidence:** High
- **file:line:** `SECURITY.md:93`; `is_ready` added by `20260516010000`; `shared-projections.test.ts` asserts `is_ready` forbidden.
- **Evidence:** Public projection correctly excludes `is_ready`; doc's Excluded list doesn't mention it (nor `user_id`, present on the table since `20260506000002`).
- **Impact:** Doc incompleteness only.
- **Recommended correction:** Add `is_ready` and `user_id` to the `list_items` Excluded list.
- **Safe for autonomous repair:** yes (doc-only).
- **Corroborating tracks:** 3 (F-3).

---

### C-09 - `SPEC.md` CSV section claims "10-column header" for both export paths; gear export emits 12
- **Severity:** Low
- **Confidence:** High
- **file:line:** `SPEC.md:138`; `src/lib/csv/gear.ts` (`gearItemsToCsv` appends `cost`, `purchase_date`)
- **Evidence:** Gear-library export = base 10 Lighterpack columns + `cost` + `purchase_date` = 12. List export = 10 only. The "both export paths emit the same 10-column header" claim is doubly wrong (count + "same").
- **Impact:** A reader writing a parser to spec would fail on 12-column gear rows.
- **Recommended correction:** Spec: gear export = 12 (10 + cost + purchase_date); list export = 10 Lighterpack-compatible; drop the "same header" claim. Round-trip test already exists in `csv/core.test.ts`.
- **Safe for autonomous repair:** yes (doc-only).
- **Corroborating tracks:** 3 (F-4).

---

### C-10 - `CLAUDE.md` supply-chain warning contradicts the now-committed `.npmrc` (`ignore-scripts=true`)
- **Severity:** Low
- **Confidence:** High
- **file:line:** `CLAUDE.md` Supply-chain section ("Do not add `ignore-scripts=true` ... without testing") vs `.npmrc` (the flag IS set); `docs/supply-chain-security.md` correctly documents it as present.
- **Evidence:** The flag was added with an accepted tradeoff; the CLAUDE.md prohibition now reads as if `.npmrc` is wrong. Track-6 verified `.npmrc` matches `docs/supply-chain-security.md` exactly.
- **Impact:** Reader confusion: prohibition vs completed-and-accepted decision.
- **Recommended correction:** Reword CLAUDE.md to "`ignore-scripts=true` IS set and was accepted after testing; if you ever remove it, re-test `rm -rf node_modules && npm ci` because `fsevents` uses an install script."
- **Safe for autonomous repair:** yes (doc-only).
- **Corroborating tracks:** 3 (F-8), 6 (verified-no-drift on `.npmrc` itself).

---

### C-11 - `need_to_buy` gear-status badge reuses `loaned_out` rose color - visually indistinguishable
- **Severity:** Low (track-5 said medium; two distinct statuses still differ by icon + label, so it is a polish issue, not a correctness/confusion failure)
- **Confidence:** High
- **file:line:** `src/lib/gear-status.ts:51-54` (`badgeClass: LOANED_OUT_BADGE_CLASS`); `src/lib/row-indicator-styles.ts` (rose class)
- **Evidence:** Both `need_to_buy` and `loaned_out` render the identical rose pill; only the icon (ShoppingCart vs other) differs.
- **Impact:** User-facing minor: two semantically different statuses look the same at a glance.
- **Recommended correction:** Add `NEED_TO_BUY_BADGE_CLASS` (e.g. sky) and wire it in `gear-status.ts`.
- **Tests needed:** Assert `need_to_buy` and `loaned_out` produce different `badgeClass`.
- **Safe for autonomous repair:** yes (mechanical; color choice is a trivial aesthetic pick, not a domain decision).
- **Corroborating tracks:** 5 (F-01).
- **Resolution (2026-06-06): WON'T FIX.** The audit missed that `gear-status.test.ts:86-90` documents the shared rose as deliberate: `loaned_out` and `need_to_buy` both mean "item not on hand" and intentionally share the "unavailable" color, with the icon (ShoppingCart vs CircleAlert) and label carrying the distinction. Owner confirmed the grouping is intended, so this is a false positive, not polish drift. The "trivial aesthetic pick" classification was wrong - it reverses a tested design choice.

---

### C-12 - Resource-cap and weight/qty magic numbers hardcoded at call sites instead of shared constants
- **Severity:** Low
- **Confidence:** High
- **file:line:** `src/gear/BulkActionsToolbar.tsx:29,77` (`300`), `src/gear/CreateListFromSelectionDialog.tsx:26,50` (`100`), `src/lists/ItemRow.tsx:161,168`, `src/components/WeightInput.tsx:78`, `src/gear/GearItemDialog.tsx:105,119,391`, `src/lib/csv/units.ts:48`, `src/lib/csv/list.ts:66` (`100000`, `9999`); existing exports `GEAR_ITEM_CAP`/`LIST_ITEM_CAP` in `src/lib/queries/import-helpers.ts:34-35`.
- **Evidence:** `LIST_ITEM_CAP=300` and `GEAR_ITEM_CAP=500` are exported but `BulkActionsToolbar`/`CreateListFromSelectionDialog` use raw `300`. `LIST_CAP=100`, `MAX_ITEM_WEIGHT_GRAMS=100000`, `MAX_LIST_ITEM_QUANTITY=9999` have no named constant at all (spread across 4-5 sites each). The DB constraints/triggers are the real enforcement; these are UX guards.
- **Impact:** Cap change requires multi-site grep; UI and DB silently drift if a site is missed. No current bug (DB enforces).
- **Recommended correction:** Centralize all caps in `import-helpers.ts` (or a new `src/lib/queries/caps.ts`): add `LIST_CAP`, `MAX_ITEM_WEIGHT_GRAMS`, `MAX_LIST_ITEM_QUANTITY`, `MAX_NAME_LENGTH`, `MAX_DESC_LENGTH`, `MAX_CATEGORY_NAME`; replace literals; end with `grep` to confirm no stragglers.
- **Tests needed:** `BulkActionsToolbar` warns exactly at `LIST_ITEM_CAP`.
- **Safe for autonomous repair:** yes (mechanical, no behavior change).
- **Corroborating tracks:** 2 (F-05, F-08, F-09, Overlapping-Systems row 5).

---

### C-13 - Within-category DnD + list mutations duplicated across the two god-files
- **Severity:** Low-impact-now / High-maintenance-risk
- **Confidence:** High
- **file:line:** within-cat DnD: `src/lists/ListDetailPage.tsx:614-668`, `src/gear/GearLibraryPage.tsx:449-542`. Duplicated `importMut`: `ListsPage.tsx:175`, `DesktopListsPanel.tsx:186`, `ListsEmptyState.tsx:76`. Duplicated `createListMut`: `ListsPage.tsx:136`, `DesktopListsPanel.tsx:171`.
- **Evidence:** Both within-category handlers implement the same slice-based `arrayMove` + `assignSortOrderSlots` + `reorder*Mut.mutate` pattern, deliberately *not* using `useReorderable` (its algebra is flat, not slice-based - documented tech debt in CLAUDE.md/CONCERNS.md). The same-tick `useQuery` colocation rule (the b8624ec snap-back race class) is met *narratively* (each page holds its own `useQuery` at the same component level) but **not structurally enforced** - a future split or prop-drill silently re-introduces the race. The list `importMut`/`createListMut` bodies are byte-identical across files, kept in sync only by convention + comments.
- **Impact:** Any fix to within-cat reorder or list-import must be made in 2-3 places. The orphan-import bug (C-05) therefore exists in 3 copies. Largest single maintenance liability in the repo.
- **Recommended correction:** (a) Extract `useWithinCategoryReorder<T>({ items, dndKind, categoryKey, reorderMutFn })` that owns the `useQuery` subscription so the colocation rule is *structural*, not narrated. (b) Extract `useListImportMutation` and fold `createListMut` into `useCurrentListActions`. Do NOT fold `ListsEmptyState`'s `sort_order: 0` path in (it is intentionally distinct; only renders at `lists.length === 0` where `nextListSortOrder([]) === 0`).
- **Tests needed:** pure-logic test that within-cat reorder no-ops on cross-category drops and emits only the active category's slice (see M-test-5); extracted-hook test for import happy/over-cap/error paths.
- **Safe for autonomous repair:** no - extraction from 900-1300 line files with interleaved state; plan + checkpoint review first.
- **Corroborating tracks:** 2 (F-01, F-02, F-03, F-04), 4 (slice-DnD context), 7 (Findings 5, 6 - no tests), CONCERNS.md.

---

### C-14 - Dead back-compat aliases in `offline-packed-queue.ts` (4 exports, zero non-test callers)
- **Severity:** Low
- **Confidence:** High
- **file:line:** `src/lib/offline-packed-queue.ts:53` (`PendingPackedState` type), `:205` (`readPendingPackedStates`), `:263` (`removePendingPackedStates`), `:377` (`subscribeToPendingPackedStates`)
- **Evidence:** Each is an alias for the `*Check*` name; production callers all import the `*Check*` symbols directly (`use-offline-packed-sync.ts`, `ListDetailPage.tsx`). Grep confirms no production import of the aliased names. Comments say "keep so a future refactor can rename gradually" - no such call site exists.
- **Impact:** Dead public-API surface; mild confusion (two names for one thing).
- **Recommended correction:** Delete the four comment+alias pairs; `grep` after removal; `npm run build`.
- **Tests needed:** None (tests use the `*Check*` names directly).
- **Safe for autonomous repair:** yes.
- **Corroborating tracks:** 4 (A-1..A-4).

---

### C-15 - Offline-queue v1->v2 migration path is effectively dead (TTL-expired) and re-runs on every cold read
- **Severity:** Low
- **Confidence:** Medium (timing-gated)
- **file:line:** `src/lib/offline-packed-queue.ts:17` (`STORAGE_KEY_V1`), `:58-131` (`migrateV1IfPresent`), plus the `if (!raw)` branch in `readStored()`
- **Evidence:** v1 was superseded by v2 when Ready Checks shipped (`20260516010000`); v1 entries carry a 30-day TTL, so the last possible live v1 entry expires **2026-06-15**. CONCERNS.md explicitly flags this for removal. The migration's swallowed errors (silent `catch`) make a partial migration undetectable, and the `failedAttempts:0` reset on re-migration is a theoretical retry-loop risk (track-1 F-6) - but only for entries still within TTL at rollout, which are now gone.
- **Impact:** ~60 lines run silently per cold read; no correctness impact today.
- **Recommended correction:** After 2026-06-15, delete `STORAGE_KEY_V1`, `migrateV1IfPresent`, and the `if (!raw)` migration branch; `readStored()` returns `{}` when no v2 key.
- **Tests needed:** Confirm existing `offline-packed-queue.test.ts` passes; add `readStored()` returns `{}` on empty storage.
- **Safe for autonomous repair:** only-after-named-decision (the named decision is "the 2026-06-15 TTL date has passed").
- **Corroborating tracks:** 1 (F-6), 4 (A-5).

---

### C-16 - Copy: `help.md` invents "sharing mode" and "packing mode"; login page says "packing mode"
- **Severity:** Low (track-5 marked F-06 high; downgraded - a help-page sentence with a slightly-off mode name is not a high-severity defect)
- **Confidence:** High
- **file:line:** `help.md:9` ("sharing mode", "packing mode"), `help.md:21` ("trip specific"), `src/auth/LoginPage.tsx:88` ("packing mode")
- **Evidence:** UI label everywhere is "Pack mode" (`PackToggle.tsx`, help.md heading). "Sharing mode" appears nowhere in the UI (`grep` = 0); the feature is "List options -> Sharing" / a public link. A user hunting for a "Sharing mode" button finds none.
- **Impact:** User-facing on `/help` and `/login`; mild expectation mismatch. Not high - no broken function, no security/data impact.
- **Recommended correction:** Rewrite `help.md:9` to "Each list has a **Pack mode** and an optional public link..."; fix `help.md:21` to "trip-specific"; change `LoginPage.tsx:88` "packing mode" -> "Pack mode".
- **Safe for autonomous repair:** yes.
- **Corroborating tracks:** 5 (F-02, F-03, F-06, F-10).

---

### C-17 - `gear-status.ts` comment pins to wrong migration and says "the other two" for three statuses
- **Severity:** Low
- **Confidence:** High
- **file:line:** `src/lib/gear-status.ts:6-9`
- **Evidence:** Comment pins the CHECK constraint to `20260516000000` (3 values) but `need_to_buy` was added by `20260526173748`; and says "the other two surface a small badge" when there are three non-active statuses.
- **Impact:** Dev-facing; misdirects a maintainer to the wrong migration.
- **Recommended correction:** Point the comment at `20260526173748`; change "the other two" -> "the remaining three".
- **Safe for autonomous repair:** yes.
- **Corroborating tracks:** 5 (F-16), 3 (F-6).

---

### C-18 - `AGENTS.md` is a claude-mem memory dump, not an agent-instructions file
- **Severity:** Low
- **Confidence:** High
- **file:line:** `AGENTS.md` (begins `<claude-mem-context>`)
- **Evidence:** Contains session event IDs, timestamps, observation logs - no coding guidelines. Any cross-agent tool (Codex/Devin) reading it for conventions gets noise.
- **Impact:** Cross-agent tooling confusion; risk of committing memory dumps.
- **Recommended correction:** Either delete + `.gitignore` it, or replace with a stub redirecting to `CLAUDE.md`.
- **Safe for autonomous repair:** only-after-named-decision (delete vs stub).
- **Corroborating tracks:** 3 (F-7).

---

### C-19 - PWA manifest description diverges from canonical tagline; no OG/Twitter meta tags
- **Severity:** Low
- **Confidence:** High (manifest) / Medium (OG omission is a gap, not a defect)
- **file:line:** `vite.config.ts:120` (`'Backpacking gear and packing list manager'`); `index.html <head>` (no `og:*`/`twitter:*`)
- **Evidence:** Canonical tagline (`about.md:3`, `LoginPage.tsx:85`) is "a backpacking gear list, weight tracker, and packing tool". Manifest drops "weight tracker" and uses "manager". `index.html` has only `<title>` + PWA tags - shared links render no preview card.
- **Impact:** App-store/install copy off-brand; bare social/link previews.
- **Recommended correction:** Align manifest description to the canonical tagline; add `og:title`/`og:description`/`og:url`/`og:type` to `index.html`.
- **Safe for autonomous repair:** yes (additive/copy-align).
- **Corroborating tracks:** 5 (F-09, F-11).

---

### C-20 - Trivial doc/comment polish bundle
- **Severity:** Low
- **Confidence:** High
- **Items:**
  - `SPEC.md` share-view section omits `group_worn`/`is_draft` from visible fields (track-3 F-5).
  - `CLAUDE.md` "only current site" for `target=_blank` should be plural - `MarkdownContent.tsx:45` is a second, correctly-paired site (track-6 CLAUDE.MD NOTE).
  - `about.md:9` vs `help.md:150` contact-line period mismatch (track-5 F-08).
  - "Lighterpack" vs "LighterPack" casing split (~15 occurrences; `flat-table-styles.ts` comments are the outlier) (track-5 F-07) - standardize on "Lighterpack" to match SPEC.md/DECISIONS.md.
  - `ListsEmptyState.tsx:121` "build packs" -> "build packing lists" (track-5 F-04); add a comment at the two `createList(userId, name, 0)` calls explaining the `sort_order: 0` invariant (track-2 F-04/F-12).
  - **Pre-existing ASCII-rule violation (found during Stage 6):** `src/lib/mutation-error-handler.ts` comments contain three em dashes (U+2014) - pre-existing on `main` (extracted 2026-05-06, after the spelling sweep), NOT introduced by Stage 6. Left untouched to avoid scope creep in PR #29; fix in this Stage-1 doc/comment bundle. Worth a quick repo-wide `grep -rlP '[^\x00-\x7F]' src/` to catch any other comment-level drift past the 2026-04-30 sweep.
- **Impact:** Minor consistency/readability.
- **Safe for autonomous repair:** yes (the "Lighterpack" casing pick is the one item that benefits from owner confirmation but defaulting to the docs' lowercase is defensible).

---

## 3. Needs investigation

| ID | Item | Missing evidence |
|---|---|---|
| NI-1 | `src/lib/csv.test.ts` (root) vs `src/lib/csv/core.test.ts` - possible legacy/overlapping test file | Diff the `it()` cases + imports; confirm whether root file duplicates the modular suite or covers distinct cases. (track-2 NI-01) |
| NI-2 | `queries.bulk-reorder.test.ts` (integration, skipped) vs `queries.bulk-reorder.unit.test.ts` | Compare `it()` clauses to confirm unit/integration split is non-overlapping (likely is - unit mocks `supabase.rpc`, integration hits real DB). (track-2 NI-02, track-7 Finding 2) |
| NI-3 | ~~`exportCsv` fire-and-forget~~ **RESOLVED -> CONFIRMED, promoted to C-21, in Stage 6** | Verified `2026-06-06`: `exportCsv` (`use-current-list-actions.ts:91-110`) is `async` with NO internal try/catch; all three call sites invoke it as `() => exportCsv(list)` (`ListsPage.tsx:284`, `ListSettingsPanel.tsx:170`, `DesktopListsPanel.tsx:374`) - un-awaited, uncaught. A failed `qc.fetchQuery` (list-items/categories network error) rejects unhandled with no user feedback. Same class as C-01..C-04. **Fix:** wrap the body in try/catch, `showToast` on failure, consume the error (no rethrow) so the fire-and-forget call sites can't reject. Now tracked as **C-21** in Stage 6. |
| NI-4 | `AuthProvider.loadInitialSession` outer `catch` could mask a programming error as logged-out when online | Track-1 NI-4 and track-6 F5 both flag this; track-6 rates it Low/Medium. Needs a decision on whether an explicit `authError` state + retry screen is wanted (UX design), not just verification. Currently no data/security impact (worst case = redirect to /login). |
| NI-5 | `README.md` reported possibly empty by track-5 (F-12) | `git status` shows `README.md` modified; track-5's "empty" read was likely a tool artifact. Verify `README.md` is non-empty before any action. Low priority, developer-facing. |

---

## 4. Canonical vocabulary

| Preferred term | Meaning | Stale / conflicting terms | Evidence | Recommended action |
|---|---|---|---|---|
| **grampacker** (lowercase) | Product wordmark | none | index.html, vite.config.ts, about.md, help.md all lowercase | None - clean (track-5 F-18) |
| **Pack mode** (two words, capitalized) | List view mode for packing checklist | "packing mode" (help.md:9, LoginPage.tsx:88) | `PackToggle.tsx` ariaLabel, help.md heading | Fix the two sites (C-16) |
| **public link / Sharing** | Per-list opt-in read-only share | "sharing mode" (help.md:9 - invented, 0 UI hits) | DECISIONS.md "Sharing is per-list, opt-in"; SharePage.tsx | Remove "sharing mode" from help.md (C-16) |
| **inventory** (data) / **gear library** (the page) | `gear_items` rows / the Gear page + picker | "your inventory" vs "your library" used interchangeably in same modal | CLAUDE.md "gear_items are the inventory"; `GearLibraryPage.tsx:905,908` | Owner decision: pick one user-facing noun per context; standardize (track-5 F-05) |
| **slug** | 6-char per-list share id | "share_token"/"shareToken"/"token" | grep = 0 stragglers | None - clean (track-5 F-17) |
| **Draft** (owner) / **Work in progress** (viewer) | Incomplete-list label (never a lock) | "WIP" (rejected in design spec) | DraftBadge.tsx / DraftBanner.tsx | None - intentional split (track-5 F-20) |
| **Lighterpack** | Third-party gear-list app | "LighterPack" in `flat-table-styles.ts` comments | SPEC.md/DECISIONS.md use lowercase-p | Standardize to "Lighterpack" (C-20) |
| **Lists** (nav) / **packing lists** (concept) | Trip-specific gear collections | "packs" (ListsEmptyState.tsx:121) | NavBar.tsx, help.md | Fix "build packs" (C-20); nav truncation is fine (track-5 F-13) |
| **is_packed/"Packed"** vs **is_ready/"Ready"** | Two distinct per-item states | - | PackingProgress.tsx | Distinction correct - keep separate |

---

## 5. Overlapping systems map

### 1. List-creation mutation
| Implementation | File:line | sort_order | Optimistic | Callers |
|---|---|---|---|---|
| `createListMut` | `ListsPage.tsx:136` | `nextListSortOrder(lists)` | yes | desktop header + mobile bar |
| `createListMut` | `DesktopListsPanel.tsx:171` | `nextListSortOrder(lists)` | yes | lg left-rail panel |
| `createMut` | `ListsEmptyState.tsx:60` | hardcoded `0` | yes | zero-list empty state |
- **Authority:** `createList()` in `queries/lists.ts`. **Behavioral diff:** empty-state `0` is correct (`nextListSortOrder([])===0`). **Consolidation:** fold the two `nextListSortOrder` copies into `useCurrentListActions`; leave `ListsEmptyState` alone. **Migration risk:** low/mechanical. (C-13)

### 2. List-import mutation
| Implementation | File:line | invalidates | Callers |
|---|---|---|---|
| `importMut` | `ListsPage.tsx:175` | lists+gear+categories | /lists header + mobile bar |
| `importMut` | `DesktopListsPanel.tsx:186` | same | lg panel |
| `importMut` | `ListsEmptyState.tsx:76` | same | zero-list state |
- **Authority:** `importCsvRowsToList()`. **Behavioral diff:** bodies identical (empty-state uses `sort_order 0`). **Critical:** the orphan-on-failure bug (C-05) lives in all three copies. **Consolidation:** extract `useListImportMutation`; fixing the orphan bug once then fixes all three. **Migration risk:** low for extraction; the RPC fix (C-05) is the larger change.

### 3. Within-category DnD (item reorder)
| Implementation | File:line | useReorderable? | cache sub | snap-back risk |
|---|---|---|---|---|
| Hand-rolled | `ListDetailPage.tsx:614-668` | no | narrated | low-but-fragile |
| Hand-rolled | `GearLibraryPage.tsx:449-542` | no | narrated | low-but-fragile |
| Structural | `ListsPage`, `DesktopListsPanel`, `GearLibraryPage` categories | yes (`useReorderable`) | structural | none |
- **Authority:** `useReorderable` (flat surfaces). **Behavioral diff:** hand-rolled paths are slice-based (deliberately not in the hook) and enforce the same-tick `useQuery` rule only by convention. **Consolidation:** new `useWithinCategoryReorder<T>` with a `groupBy`/categoryKey concept. **Migration risk:** medium (extraction from god-files). (C-13)

### 4. Row kebab menus
| Implementation | File:line | Callers | Divergence |
|---|---|---|---|
| `RowKebab` | `ItemRow.tsx:622` | list rows | has `onRemoveFromList`; optional `onEdit?`/`onDeleteFromInventory?` |
| `GearRowKebab` | `GearItemRow.tsx:237` | gear rows | no remove-from-list; all required |
| inline kebabs | `ListsPage.tsx`, `DesktopListsPanel.tsx` | list cards | own menu shapes |
- **Authority:** both use `useAnchoredMenu`+`RowMenuItem` correctly, share `GearStatusMenuItems`. **Divergence is intentional** (list-context extras). **Consolidation:** optional `GearRowKebabBase` taking `onRemoveFromList?`; quality-of-life, not a bug. **Risk:** low. (track-2 F-06)

### 5. Numeric resource caps - see C-12. Authority = DB constraints/triggers; client constants are UX guards. Centralize in `caps.ts`. Risk: trivial.

### 6. Weight-unit conversion constants
| Constant | File | Direction |
|---|---|---|
| `OZ_PER_GRAM=0.035274` | `weight.ts:3` | g->oz (display) |
| `28.3495` | `csv/units.ts:25` | oz->g (import) |
| `453.592` | `csv/units.ts:30` | lb->g (import) |
- Mathematical inverses (error ~9e-9), not duplicates; intentional separation. **Optional:** export `GRAMS_PER_OZ`/`GRAMS_PER_LB` from `weight.ts`, import in `csv/units.ts` (no circular dep today). Not a bug. (track-2 F-07)

### 7. Projections (gear_item column list) - `GEAR_ITEM_AUTH_SELECT`/`GEAR_ITEM_PUBLIC_SELECT` in `projections.ts`, locked by `shared-projections.test.ts`. **Well-handled, no duplication.** (track-2 F-12, track-3) - but note the *secondary* `EMBEDDED_GEAR_FIELDS` set in `list-items-fan-out.ts` is a hand-maintained mirror with no sync test (M-test-3).

---

## 6. Dead-code inventory

### Confirmed removable (no timing gate)
| Symbol | File:line | Reason |
|---|---|---|
| `export type PendingPackedState` | `offline-packed-queue.ts:53` | zero non-test callers |
| `export const readPendingPackedStates` | `offline-packed-queue.ts:205` | zero non-test callers |
| `export const removePendingPackedStates` | `offline-packed-queue.ts:263` | zero non-test callers |
| `export const subscribeToPendingPackedStates` | `offline-packed-queue.ts:377` | zero non-test callers |

(C-14. All four are aliases for `*Check*` names; production imports the `*Check*` symbols directly.)

### Superseded but migration-sensitive
| Symbol | File:line | Gate |
|---|---|---|
| `migrateV1IfPresent` + `STORAGE_KEY_V1` + `readStored` v1 branch | `offline-packed-queue.ts:17,58-131` | Remove after **2026-06-15** (v1 TTL expiry); CONCERNS.md flags it. (C-15) |

### Needs runtime verification
None beyond CONCERNS.md.

### False positives examined and retained (coverage proof)
`queuePendingPackedState`/`queuePendingReadyState`, `applyPendingPackedStates`/`applyPendingReadyStates` (domain-meaningful wrappers, active callers); `reorderCategories/GearItems/Lists/ListItems` (1-line table-name delegators but enforce barrel convention - naming decision, not dead); `useAnchoredMenu` (adds real geometry logic, 7 callers); `FormLabel` (9 callers, style-token convention); `optimisticListPlaceholder`, `clearSupabaseRestCache`, `asButtonRef`, `fetchAllUserListItems`, `useGroupedListItems`, `useStableWornItems`, `list-items-fan-out` exports, `randomTempId`, `generateSlug`, `useRequireSession`, `useListCardSortable`, `ConfirmDialog`, `TypedConfirmDialog`, `AboutLink`, `DraftBadge`, `mutationErrorHandler`, `csv/index.ts` barrel, `usePortalPopover` - all have active callers (track-4 verified). Confirmed *correctly absent*: `(deleted item)` placeholder (removed in `5fac55f`), `makeOptimisticCrossCategoryMove` (never written, per ADR). (track-4)

---

## 7. Drift matrix

| Domain | Schema (migrations) | TS types | Query projections | Tests | UI assumptions | Docs | Finding |
|---|---|---|---|---|---|---|---|
| **lists** | 13 cols complete | match | `fetchLists` `select('*')` (implicit) | `shared-projections` locks `fetchSharedList` | reads is_draft/group_worn/ready_checks_enabled | SECURITY.md:92 stale; SPEC share-view incomplete | C-06, C-20 |
| **list_items** | 12 cols complete | match | `*` + explicit gear join | locks `fetchSharedListItems` | reads is_ready | SECURITY.md:93 missing is_ready/user_id | C-08 |
| **gear_items** | 12 cols complete | match | `fetchGearItems` `select('*')`; join explicit | locks both join projections | reads cost/purchase_date/status | SECURITY.md:94 missing cost/purchase_date/status from Excluded | C-07 |
| **categories** | 6 cols, no updated_at | match | `fetchSharedListCategories` explicit (no runtime guard) | not locked for runtime guard | reads id/name/sort_order/is_default | SECURITY.md:95 correct | M-test/track-6 F3 |
| **profiles** | 3 cols | no type (intentional) | not queried | n/a | n/a | n/a | clean |
| **sharing/PublicList** | group_worn, is_draft present | PublicList correct | matches type | locked | SharePage renders both | SECURITY.md:92 stale; SPEC incomplete | C-06, C-20 |
| **GearStatus** | `need_to_buy` via 20260526173748 | type correct | n/a | n/a | renders need_to_buy badge (shared rose - intentional, see C-11 Resolution) | gear-status.ts comment pins wrong migration | C-11 (won't fix), C-17 |
| **CSV export** | n/a | n/a | n/a | 12-col round-trip in core.test | gearItemsToCsv emits 12 | SPEC says "10 for both" | C-09 |
| **EMBEDDED_GEAR_FIELDS** | n/a | mirrors AUTH projection | hand-maintained set | NOT sync-tested vs projection | fan-out decision | - | M-test-3 |
| **supply chain** | n/a | n/a | n/a | n/a | n/a | CLAUDE.md warning vs `.npmrc` | C-10 |
| **AGENTS.md** | n/a | n/a | n/a | n/a | n/a | memory dump, not instructions | C-18 |

All confirmed drift is **doc-side**; schema/types/projections are internally consistent and the public-projection boundary is test-locked.

---

## 8. Missing-test inventory

| ID | Absent test | Maps to finding | Defect class it would catch |
|---|---|---|---|
| M-test-1 | `parseListCsv` with a row where both `worn` and `consumable` are truthy -> `is_worn:false, is_consumable:false` | SPEC `bothSet` rule (track-7 F1) | Silent change to the both-flags-cleared rule (could start throwing DB 42P10 or silently prefer one flag), breaking imports from tools that emit both. Pure logic, trivial to add. |
| M-test-2 | Re-auth-failure + reentrancy tests for delete-account flow (`SettingsPage`) | track-7 F4 | Removing `if (busy) return` or the `signInWithPassword` re-auth gate lets a double-submit race or unauthenticated destructive delete through. Currently **zero** SettingsPage tests. |
| M-test-3 | Assert `EMBEDDED_GEAR_FIELDS` covers every column in `GEAR_ITEM_AUTH_SELECT` | track-7 F3, drift-matrix EMBEDDED row | Widening the auth projection without updating the fan-out set -> stale list-view caches after gear edits (invisible for the 30s staleTime). Add to `list-items-fan-out.test.ts`. |
| M-test-4 | `SharePage` error-state render (fetchSharedList rejects -> "not found" UI) | track-7 F7 | A regression rendering nothing/stale content on share-fetch error ships undetected. |
| M-test-5 | Pure within-category reorder payload helper (cross-category drop no-ops; only active slice emitted) | C-13, track-7 F6 | Cross-category contamination in the reorder payload corrupts sort_order across categories. Requires extracting the inline algebra from `ListDetailPage.handleDragEnd` first. |
| M-test-6 | `useReorderable` hook-level colocation test (`useQuery` fires inside the hook, optimistic write same tick) | C-13, track-7 F5 | A prop-drilling refactor re-introduces the b8624ec snap-back race silently. |
| M-test-7 | Mutation-error-feedback tests for C-01..C-04 (each rejected mutation surfaces a toast/dialog) | C-01..C-04 | Re-introducing a missing `onError`/catch on a non-optimistic action ships silently. |
| M-test-8 | (infra, not a new test) Configure `TEST_USER_EMAIL`/`TEST_USER_PASSWORD` so the integration bulk-reorder file (`queries.bulk-reorder.test.ts`) actually runs | track-7 F2 | Server-side RPC/trigger/RLS/`updated_at`-noop regressions invisible until a user hits them. Requires CI secret decision. |
| M-test-9 | `BulkActionsToolbar` warns exactly at `LIST_ITEM_CAP` | C-12 | Cap-constant substitution regressions. |
| M-test-10 | Optional: runtime guard on `fetchSharedListCategories` + test (mirror `assertPublicListItems`) | track-6 F3 | A future `select('*')` regression on categories leaks extra columns into the share cache with no loud error. Defense-in-depth, not a current defect. |

---

## 9. Staged cleanup plan

Dependency-ordered, each stage independently reviewable. **Plan only - do not execute.** TDD/subagent guidance per stage.

### Stage 1 - Doc/comment drift fixes (zero code, zero behavior)
- **Scope:** Update `SECURITY.md:92,93,94` allowlists/exclusions; SPEC.md CSV "10->12" + share-view group_worn/is_draft; CLAUDE.md supply-chain `ignore-scripts` reword + `target=_blank` "sites" plural; `gear-status.ts` comment (migration ref + "other two"); `about.md` contact period; "Lighterpack" casing sweep.
- **Finding IDs:** C-06, C-07, C-08, C-09, C-10, C-17, C-20.
- **Invariants:** No code/type/test change; `shared-projections.test.ts` must still pass unchanged.
- **Tests required:** none (run full suite to confirm green).
- **Risk:** trivial. **TDD/subagent:** no - pure doc edits; verify with `npm run build` + grep.

### Stage 2 - Copy + branding polish (user-facing strings only)
- **Scope:** `help.md:9,21` ("sharing/packing mode", "trip specific"), `LoginPage.tsx:88` "Pack mode", `ListsEmptyState.tsx:121` "build packs", PWA manifest tagline, add OG meta to `index.html`, comment the `sort_order:0` invariant in `ListsEmptyState`.
- **Finding IDs:** C-16, C-19, C-20 (ListsEmptyState comment).
- **Invariants:** no functional change; "inventory vs gear library" left for owner decision (out of scope here).
- **Tests required:** none.
- **Risk:** trivial. **TDD/subagent:** no.

### Stage 3 - Constant centralization
- **Scope:** Create `src/lib/queries/caps.ts` (or widen `import-helpers.ts`): `LIST_CAP`, `MAX_ITEM_WEIGHT_GRAMS`, `MAX_LIST_ITEM_QUANTITY`, `MAX_NAME_LENGTH`, `MAX_DESC_LENGTH`, `MAX_CATEGORY_NAME`; replace all literal sites; re-export via `queries/index.ts`. Optionally export `GRAMS_PER_OZ`/`GRAMS_PER_LB`.
- **Finding IDs:** C-12 (+ track-2 F-07).
- **Invariants:** values unchanged; DB remains the enforcement layer; end with `grep -rn '100000\|9999\|300\|100'` to confirm no production stragglers.
- **Tests required:** M-test-9 (toolbar warns at cap).
- **Risk:** low. **TDD/subagent:** light TDD (write the cap-boundary test first).

### Stage 4 - Dead-code removal (offline-queue aliases)
- **Scope:** Delete the 4 back-compat aliases (C-14).
- **Finding IDs:** C-14.
- **Invariants:** production imports `*Check*` names; build stays green.
- **Tests required:** existing suite passes; `grep` confirms removal.
- **Risk:** low. **TDD/subagent:** no.

### Stage 5 - Badge color + need_to_buy distinction - WON'T FIX (2026-06-06)
- **Scope:** ~~Add `NEED_TO_BUY_BADGE_CLASS`, wire in `gear-status.ts`.~~ Dropped.
- **Finding IDs:** C-11 (closed as a false positive - see the finding's Resolution note).
- **Reason:** The shared "not on hand" rose is a deliberate, tested design choice; making the two statuses distinct would reverse it. Icon + label already differentiate them.

### Stage 6 - Non-optimistic mutation error feedback (the silent-failure batch) - (done) DONE (PR #29, 2026-06-06)

> Implemented via subagent-driven TDD on branch `fix/mutation-error-feedback` (PR #29). C-01..C-04 + C-21 closed; convention added to CLAUDE.md + SPEC.md. Owner corrections applied: C-01 consumes (no rethrow), C-02 title fixed, NI-3 promoted to C-21 and included. `mutation.options.meta.errorToast` routed through the global `mutationErrorHandler`; non-mutation actions use try/catch+consume. 385 tests pass, build+lint clean. Reset component test deferred (god-file-inline, no harness).

- **Scope (six sites, all `showToast({type:'error'})`):**
  - `addNewItemMut` (`ListDetailPage.tsx:565`): add `onError` -> toast. (C-03)
  - `duplicateMut` (`use-current-list-actions.ts:71`): add `onError` -> toast. (C-04)
  - `createListFromSelectionMut` (`GearLibraryPage.tsx:383`): add `onError` -> toast; dialog stays open so the user can retry/cancel. (C-02)
  - `resetPacked` / `resetReady` (`ListDetailPage.tsx:670,713`): in the existing `catch`, after the field-scoped rollback, `showToast` and **CONSUME** the error - delete `throw err` (option (a); keeps the `() => void` contract and removes the unhandled rejection). Do NOT toast-then-rethrow. (C-01)
  - `exportCsv` (`use-current-list-actions.ts:91`): wrap the body in try/catch, toast on failure, consume (no rethrow) so the three fire-and-forget call sites can't reject. (C-21)
- **Plus:** add the three-bullet convention (see C-01..C-04 systemic note) to `CLAUDE.md`; update `SPEC.md` "Toast notifications -> Current usage" to reflect that these non-optimistic actions now toast on failure (optimistic mutations still rely on silent rollback).
- **Finding IDs:** C-01, C-02, C-03, C-04, C-21.
- **Invariants:** preserve the field-scoped rollback in `resetPacked`/`resetReady` (touch only the cleared field's ids); do NOT add toasts to the optimistic mutations (documented policy); **keep diffs surgical - no god-file refactor, no DnD/extraction work in this stage.**
- **Tests required:** M-test-7 - one test per site: a rejected mutation/action surfaces a toast (spy on `showToast`); for the resets, also assert the field-scoped cache rollback still runs and no rejection escapes.
- **Risk:** low-medium (edits inside the two god-files but additive `onError` lines + one try/catch; no structural change). **TDD/subagent:** **yes - Superpowers TDD + subagent-driven-development**; write the rejection->feedback test first per site.

### Stage 7 - Timed dead-code removal (v1 migration)
- **Scope:** After 2026-06-15, delete `STORAGE_KEY_V1`, `migrateV1IfPresent`, `readStored` v1 branch.
- **Finding IDs:** C-15.
- **Invariants:** `readStored()` returns `{}` on empty/no-v2 storage; existing offline-queue tests pass.
- **Tests required:** empty-storage returns `{}`.
- **Risk:** low (gated on date). **TDD/subagent:** no.

### Stage 8 - Missing-test backfill (no production change)
- **Scope:** M-test-1 (CSV both-flags), M-test-3 (EMBEDDED_GEAR_FIELDS sync), M-test-4 (SharePage error), M-test-2 (delete-account guard), M-test-10 (categories runtime guard + test). M-test-8 is a CI-secret decision (separate).
- **Finding IDs:** track-7 F1/F3/F4/F7, track-6 F3.
- **Invariants:** tests only; no production edits except the optional categories runtime guard (gate behind its own review).
- **Tests required:** the tests themselves.
- **Risk:** low (M-test-2 needs a Supabase-auth jsdom mock decision). **TDD/subagent:** **yes - subagent-driven** for the independent test files.

### Stage 9 - List-import + create-list consolidation (HIGHER RISK)
- **Scope:** Extract `useListImportMutation` and fold `createListMut` into `useCurrentListActions`; collapse the `ListsPage`/`DesktopListsPanel` duplicates. Do NOT fold `ListsEmptyState`.
- **Finding IDs:** C-13 (import/create duplication), enables a single-site fix for C-05.
- **Invariants:** identical cache invalidation + navigation behavior on all surfaces; `ListsEmptyState` keeps `sort_order:0`.
- **Tests required:** extracted-hook tests (happy/over-cap/error).
- **Risk:** medium. **TDD/subagent:** **yes - Superpowers TDD + checkpoint review**; survey before touching code (god-files).

### Stage 10 - Orphan-import transaction fix (DECISION MADE: atomic RPC)
- **Scope:** Make CSV list-import atomic via a new `SECURITY INVOKER` RPC (e.g. `create_list_with_imported_items`) modeled on `create_list_from_selection` - single transaction over list + categories + gear + list_items. Client cleanup explicitly rejected (best-effort, can fail mid-cleanup, wouldn't remove orphaned categories/gear). Requires a migration.
- **Finding IDs:** C-05.
- **Invariants:** preserve dedup (`resolveOrCreateGearForImport` triple-key), per-user caps, ownership, RLS/security, and slug-retry; a failed import leaves zero new rows in `lists`, `categories`, `gear_items`, `list_items`.
- **Tests required:** integration forcing a LATE failure; assert before/after counts+state unchanged across all four tables (not just "list removed").
- **Risk:** medium-high (migration + transaction semantics). **TDD/subagent:** yes - Superpowers TDD; this is a separate later cleanup stage, not part of Stage 6.

### Stage 11 - Within-category DnD hook extraction (HIGHEST RISK)
- **Scope:** Extract `useWithinCategoryReorder<T>` owning the `useQuery` subscription; migrate `ListDetailPage` and `GearLibraryPage` within-cat handlers to it; first extract the pure slice-payload helper (M-test-5) so the algebra is unit-tested before the hook move.
- **Finding IDs:** C-13, M-test-5, M-test-6.
- **Invariants:** cross-category drops no-op; only the active category's slice mutates; same-tick `useQuery` colocation now *structural*; no snap-back regression.
- **Tests required:** M-test-5 (pure helper) first, then M-test-6 (hook colocation).
- **Risk:** high (god-file extraction, interleaved state, merge-conflict surface). **TDD/subagent:** **yes - Superpowers TDD mandatory**; extract pure logic + test green BEFORE the structural move; checkpoint review between helper-extraction and hook-migration.

---

## 10. Clean areas (inspected, no material problem)

- **Public-projection boundary is test-locked.** `shared-projections.test.ts` pins the exact select strings for all four public fetchers and asserts forbidden columns (`cost`, `purchase_date`, `status`, `is_ready`, `user_id`, `sort_order`). Code, types, and tests are mutually consistent; the only drift is in the SECURITY.md prose (C-06..C-08).
- **RLS model is sound.** All five content tables have RLS; `rls_auto_enable` fires on CREATE TABLE; `20260512000000` replaced the `FOR ALL + multiple permissive` shape with explicit per-(role,action) policies; composite cross-owner FK (`20260506000002`) matches ADR 12. SECURITY DEFINER inventory (3 functions) matches migrations. No gap between SECURITY.md security claims and migration reality.
- **Optimistic fan-out helper is correct.** `makeOptimisticUpdateWithFanout` owns the cancel/snapshot/write/rollback/settle lifecycle across both caches; `patchAffectsListItemsView` correctly gates on the embedded field set (the only gap is a *missing sync test*, M-test-3, not a defect).
- **No XSS surfaces.** No `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write` in production `src/`; react-markdown used without `rehype-raw`; both `target="_blank"` sites correctly pair `rel="noopener noreferrer"`.
- **Supply chain hardened and consistent.** `.npmrc` (`save-exact`, `min-release-age=7`, `ignore-scripts=true`, npm-registry-only, `allow-git=root`) matches `docs/supply-chain-security.md`; CI actions pinned to full SHAs. Only CLAUDE.md prose lags (C-10).
- **`bulk_update_sort_order` RPC is injection-free** in its current form (`20260514202025` static if/elsif branches; the original `EXECUTE format(...)` is superseded). `delete_account` has the `auth.uid() is null` check; residual "stolen JWT" risk is documented and accepted.
- **Dead-code false positives cleared.** ~25 symbols examined and confirmed live; `(deleted item)` placeholder and `makeOptimisticCrossCategoryMove` confirmed correctly absent.
- **Vocabulary clean spots:** wordmark "grampacker" consistently lowercase; `share_token`->`slug` rename complete (0 stragglers); Draft/Work-in-progress split intentional and documented.
- **Schema/type completeness:** lists/list_items/gear_items/categories all have exact migration<->type column parity; `categories` correctly omits `updated_at`; `profiles` intentionally has no TS type.
- **Build + suite green:** `tsc -b && vite build` clean; 379 tests pass (4 skipped are credential-gated integration tests, not failures).

---

*End of synthesized audit report.*
