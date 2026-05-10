# grampacker — Phase 12 fixes (2026-05-05)

**Source:** `REVIEW-quality.md` — pure-stylistic + nit cluster (W-2, W-9, parseDnDId KINDS const tuple deferred from Phase 11, N-1, N-3, N-4) plus one audit-stale closure (N-2).
**Scope:** six small refactors + one documentation closure + summary. **Seven commits, NO behavior change anywhere.**
**Why this is one phase:** all items are mechanically tiny, individually below the threshold for their own phase, but together they close the remaining stylistic surface in `REVIEW-quality.md`. After this lands, the substantive un-shipped items in REVIEW-quality.md are W-6 (groupByCategory consolidation, Phase-5-coupled, deserves its own phase) and the M-cluster (observable behavior changes, separate review). Two further items are explicitly deferred out of this phase: N-5 (csv.ts file split — non-trivial restructure, deferred to its own phase) and the test-coverage cluster (additions, not refactors — separate planning track).

> **Note on file paths:** all paths are repo-relative.
> **Phase 11 baseline:** main bundle = **187.36 KB gzip**. Bundle delta expected: ≈ 0 (the W-2 dead-`.slice()` removal saves bytes; the W-9 docstring hoist removes ~16 lines of comments that already weren't in the bundle; the rest are micro-edits).
> **Risk profile:** very low. No behavior change at any commit. Build + lint + tests are the verification floor.

---

## How to execute this file

Seven commits. Order doesn't matter — none depend on each other.

For each commit:
1. Make the change.
2. Run `npm run build` — pass.
3. Run `npm run lint` — pass.
4. Run `npm test --run` — 32 passed | 4 skipped (no test changes in this phase).
5. Manual smoke per the commit's verification section (mostly trivial).

---

## Commit 1 — W-2: drop redundant `.slice()` in `assignSortOrderSlots`

**Origin:** `REVIEW-quality.md` W-2 (Warning).

**Why:**

`src/lib/grouping.ts:148-155`:

```ts
const slots = reorderedItems.map((i) => i.sort_order).slice().sort((a, b) => a - b)
```

`.map(...)` already returns a fresh array; the `.slice()` is dead. Drop it.

The `slots[idx]!` non-null assertion is justified (the audit explicitly notes this) — `slots` and `reorderedItems` have identical length by construction, so every `idx` from the second `.map()` callback is a valid index. Leave the bang in place; only the `.slice()` is in scope.

**Files:**

- Modify: `src/lib/grouping.ts:151`

**What to do:**

```ts
// Before:
const slots = reorderedItems.map((i) => i.sort_order).slice().sort((a, b) => a - b)

// After:
const slots = reorderedItems.map((i) => i.sort_order).sort((a, b) => a - b)
```

**Verification:**

- Build + lint + tests pass.
- `assignSortOrderSlots` is exercised by every reorder operation (cards, items, gear, categories on /gear). Manual smoke: drag-reorder one of each, confirm post-refresh persistence — but the change is mechanical and zero-runtime, so build alone is sufficient.

**Acceptance criteria:** dead `.slice()` gone; behavior preserved.

**Suggested commit:** `refactor(grouping): drop dead .slice() in assignSortOrderSlots (W-2)`

---

## Commit 2 — W-9: hoist the "Owner-scoped private read" docstring to `queries/index.ts`

**Origin:** `REVIEW-quality.md` W-9 (Warning).

**Why:**

Four near-identical docstring blocks across the four query helper files describe the same "Owner-scoped private read" pattern, each tweaked to mention its own table:

- `src/lib/queries/categories.ts:5-9`
- `src/lib/queries/gear.ts:7-11`
- `src/lib/queries/lists.ts:41-45`
- `src/lib/queries/list-items.ts:7-11`

The full architectural reasoning already lives in `SECURITY.md` "Query-level owner scoping". The local docstrings duplicate that explanation four times with one-token variations. **Fix:** replace each per-file block with a one-line pointer back to a single hoisted block in `src/lib/queries/index.ts`.

**Files:**

- Modify: `src/lib/queries/index.ts` — add the hoisted block as a top-of-file comment.
- Modify: `src/lib/queries/categories.ts:5-9` — replace docstring with one-line pointer.
- Modify: `src/lib/queries/gear.ts:7-11` — same.
- Modify: `src/lib/queries/lists.ts:41-45` — same.
- Modify: `src/lib/queries/list-items.ts:7-11` — same.

**What to do:**

### Step 1 — add the hoisted block in `queries/index.ts`

Add at the top of `src/lib/queries/index.ts`, before the existing exports:

```ts
// Convention for owner-scoped private read helpers (`fetchLists`,
// `fetchGearItems`, `fetchCategories`, `fetchListItems`):
//
// Each helper takes a required `userId: string` parameter and applies
// it as an explicit `.eq('user_id', userId)` filter, even though RLS
// would gate ownership anyway. The redundant filter is defense in
// depth against the cross-channel leak from public *_select_shared
// policies — a signed-in user's `select('*')` would otherwise return
// own rows PLUS any other user's transitively-readable shared rows.
//
// See SECURITY.md "Query-level owner scoping" for the full rationale
// and the policy-level reason the public policies have no `TO` clause.
//
// New private helpers must follow this pattern. Public-read helpers
// (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`)
// intentionally don't filter by user_id — they rely on the
// *_public_select_* policies, and that asymmetry is the whole point
// of the cross-channel-leak defense.
```

### Step 2 — replace each per-file block with a pointer

For each of the four files, replace the existing 5-line "Owner-scoped private read" block with a one-line pointer:

```ts
// Owner-scoped private read — see queries/index.ts for the convention.
```

Match the existing leading-blank-line / following-blank-line spacing exactly so diffs stay clean.

**Verification:**

- Build + lint + tests pass.
- `git diff src/lib/queries/` shows the pointer line replacing each 5-line block.

**Acceptance criteria:** four docstring blocks collapsed to one-line pointers + one hoisted authoritative block. No behavior change.

**Suggested commit:** `docs(queries): hoist owner-scoped private read convention to queries/index.ts (W-9)`

---

## Commit 3 — W-12 follow-up: extract `KINDS` const tuple in `parseDnDId`

**Origin:** `REVIEW-quality.md` W-12 (Warning) — the audit's second-half recommendation, deferred at the end of Phase 11 with a promise to land in this nit cluster.

**Why:**

`src/lib/dnd-ids.ts` body:

```ts
if (kind !== 'category' && kind !== 'gear-item' && kind !== 'item' && kind !== 'list-card') {
  return null
}
```

The four-arm chain reads fine for the current count, but it's brittle to additions: a new `DnDIdKind` would have to be added in two places (the type union AND the runtime check) without any cross-link. A `const KINDS = [...] as const` plus an `includes()`-with-typeguard check is a one-source-of-truth alternative.

**Files:**

- Modify: `src/lib/dnd-ids.ts:25-46`

**What to do:**

```ts
// Before:
export type DnDIdKind = 'category' | 'gear-item' | 'item' | 'list-card'
...
if (kind !== 'category' && kind !== 'gear-item' && kind !== 'item' && kind !== 'list-card') {
  return null
}

// After:
const DND_KINDS = ['category', 'gear-item', 'item', 'list-card'] as const
export type DnDIdKind = (typeof DND_KINDS)[number]

function isDnDIdKind(kind: string): kind is DnDIdKind {
  return (DND_KINDS as readonly string[]).includes(kind)
}
...
if (!isDnDIdKind(kind)) return null
```

The type union now derives from the runtime const, so adding a new kind requires a single edit. The `isDnDIdKind` typeguard is required (not just `DND_KINDS.includes(kind as DnDIdKind)`) because a cast in the predicate doesn't narrow `kind` for the subsequent `return { kind, id }`. With the typeguard, TS narrows `kind` to `DnDIdKind` along the success branch and the existing return shape continues to type-check. The cast inside the typeguard widens `DND_KINDS` to `readonly string[]` so `.includes(kind)` accepts an arbitrary `string` argument (without it, `.includes` requires a `DnDIdKind` and rejects the wider `string`).

**KNOWN RISK:** if `DND_KINDS` is exported, callers that don't currently import `DnDIdKind` could start importing the runtime tuple. To avoid a ballooning surface, **keep `DND_KINDS` un-exported** — only the type is exported. Verify with `grep -rn "DND_KINDS" src/` after the commit; should return only the one definition site.

**Verification:**

- Build + lint + tests pass.
- `tsc -b` confirms the derived `DnDIdKind` type-checks identically against all existing call sites.

**Acceptance criteria:** runtime check uses the const tuple; type union derives from it; no callsite changes required.

**Suggested commit:** `refactor(dnd): extract DND_KINDS const tuple as single source of truth (W-12 follow-up)`

---

## Commit 4 — N-1: drop pointless `mutationFn` arrow wrappers

**Origin:** `REVIEW-quality.md` N-1 (Nit).

**Why:**

`mutationFn: (id: string) => deleteList(id)` is exactly equivalent to `mutationFn: deleteList`. The arrow adds nothing — same parameters in, same call out — but creates a fresh closure per render that defeats trivial referential equality (relevant if the mutation is ever passed somewhere that uses it as a memo dep).

Three sites have this exact unwrapped-arrow shape:

- `src/lists/ListsPage.tsx:153` — `mutationFn: (id: string) => deleteList(id)` → `mutationFn: deleteList`
- `src/gear/GearLibraryPage.tsx:173` — `mutationFn: (id: string) => deleteCategory(id)` → `mutationFn: deleteCategory`
- `src/lists/ListDetailPage.tsx:266` — `mutationFn: (itemId: string) => deleteListItem(itemId)` → `mutationFn: deleteListItem`

The other `mutationFn: (...) => ...` wrappers in the codebase are **not** in scope — they capture closure values (`userId`, `lists.length`, `list.id`, etc.) that aren't passed in via mutation arguments. Those wrappers are load-bearing.

**Files:**

- Modify: `src/lists/ListsPage.tsx:153`
- Modify: `src/gear/GearLibraryPage.tsx:173`
- Modify: `src/lists/ListDetailPage.tsx:266`

**What to do:**

For each of the three sites, replace the arrow with the bare function reference. Pre-flight verify the wrapper is genuinely passthrough (single arg in, same arg out, no closure values referenced). The grep above confirmed; re-confirm by reading 2-3 lines around each at execution time.

**Verification:**

- Build + lint + tests pass. `tsc -b` will catch any signature mismatch (e.g. if a function returns something the call site uses but the wrapper was dropping).

**Acceptance criteria:** three mutationFn arrows replaced with bare function references; behavior preserved.

**Suggested commit:** `refactor(mutations): drop pointless mutationFn arrow wrappers (N-1)`

---

## Commit 5 — N-3: use stable id for `WeightTable` row keys

**Origin:** `REVIEW-quality.md` N-3 (Nit).

**Why:**

`src/lists/WeightTable.tsx:91`:

```tsx
{catRows.map((row) => (
  <tr key={row.name}>
```

`row.name` is the category name. Categories aren't `UNIQUE(user_id, name)` — two categories with the same name would collide on key, producing React's "Encountered two children with the same key" warning and potentially render anomalies (state attached to one row leaking to the other). Today nobody has two categories with the same name (the gear-page UI doesn't enforce uniqueness, but users tend not to create duplicates), so the bug is latent.

**Fix:** thread a stable id through the row shape. The Uncategorized row has no category id; use a sentinel string `'__uncategorized__'` (matches the same convention used elsewhere in the codebase — see `src/gear/GearLibraryPage.tsx`'s `collapsibleKeys` map).

**Files:**

- Modify: `src/lists/WeightTable.tsx` — `WeightBreakdown.catRows` shape, both push paths, and the JSX key.

**What to do:**

### Step 1 — extend the row shape

```ts
// Before:
export type WeightBreakdown = {
  catRows: { name: string; grams: number }[]
  ...
}

// After:
export type WeightBreakdown = {
  catRows: { id: string; name: string; grams: number }[]
  ...
}
```

### Step 2 — populate `id` at both push sites

```ts
// In the named-category map:
const catRows = sortedCats.map((c) => {
  const grams = basePerCat.get(c.id)
  if (grams === undefined) throw new Error('computeWeightBreakdown: filtered key missing — unreachable')
  return { id: c.id, name: c.name, grams }
})

// In the Uncategorized push:
if (uncatGrams !== undefined) {
  catRows.push({ id: '__uncategorized__', name: 'Uncategorized', grams: uncatGrams })
}
```

### Step 3 — use `row.id` in the JSX key

```tsx
{catRows.map((row) => (
  <tr key={row.id}>
```

**Verification:**

- Build + lint + tests pass. `WeightTable.test.ts` covers `computeWeightBreakdown`; the row-shape extension may need a test update if assertions are deep-equal — read the test before committing.
- Manual smoke: pack-weight totals on `/lists/<id>` render unchanged.

**Acceptance criteria:** `<tr>` key is a stable id; same-name category collision no longer possible.

**Suggested commit:** `fix(weight-table): use stable id for category row key (N-3)`

---

## Commit 6 — N-4: replace `ACTIVE_CLASSES[variant]!` with `??` fallback in `RowIconButton`

**Origin:** `REVIEW-quality.md` N-4 (Nit).

**Why:**

`src/components/RowIconButton.tsx:57`:

```ts
const stateClass = active && ACTIVE_CLASSES[variant] ? ACTIVE_CLASSES[variant]! : VARIANT_CLASSES[variant]
```

The `ACTIVE_CLASSES[variant]!` bang is gated by the truthy check immediately to its left, so it's mechanically safe. But the bang is unnecessary noise — the same expression with `??` is shorter, removes the bang, and reads more directly:

```ts
const stateClass = active ? (ACTIVE_CLASSES[variant] ?? VARIANT_CLASSES[variant]) : VARIANT_CLASSES[variant]
```

Or, slightly more compact:

```ts
const stateClass = (active && ACTIVE_CLASSES[variant]) || VARIANT_CLASSES[variant]
```

Pick whichever form reads cleanest. The audit recommended the `??` form; defaulting to that.

**Files:**

- Modify: `src/components/RowIconButton.tsx:57`

**What to do:**

```ts
// Before:
const stateClass = active && ACTIVE_CLASSES[variant] ? ACTIVE_CLASSES[variant]! : VARIANT_CLASSES[variant]

// After:
const stateClass = active ? (ACTIVE_CLASSES[variant] ?? VARIANT_CLASSES[variant]) : VARIANT_CLASSES[variant]
```

**Verification:**

- Build + lint + tests pass.
- Visual: `RowIconButton` renders identically across all callsites — both states (active true / false) for both variants (default / danger). The `??` form falls back to `VARIANT_CLASSES[variant]` when `ACTIVE_CLASSES[variant]` is undefined, which is the same behavior the previous ternary produced.

**Acceptance criteria:** bang gone; `??` form reads as documented; rendered classes unchanged.

**Suggested commit:** `refactor(row-icon-button): replace ACTIVE_CLASSES bang with ?? fallback (N-4)`

---

## Commit 7 — Append Phase 12 summary to REVIEW-FIX.md (includes N-2 audit-stale closure)

**File:** `.planning/REVIEW-FIX.md`

```markdown
# grampacker — Phase 12 fix summary (2026-05-05)

## Shipped

- **Commit 1 (W-2) — `<hash>`** — `assignSortOrderSlots` in `src/lib/grouping.ts` no longer chains `.slice()` after `.map()`. `.map()` already returns a fresh array; the `.slice()` was dead. The `slots[idx]!` bang stays — `slots` and `reorderedItems` have identical length by construction, the audit acknowledges this.
- **Commit 2 (W-9) — `<hash>`** — Four duplicated "Owner-scoped private read" docstrings in the query helpers replaced with one-line pointers back to a single hoisted block at the top of `src/lib/queries/index.ts`. The full architectural reasoning lives in `SECURITY.md` "Query-level owner scoping"; the per-file blocks now point there via the index.
- **Commit 3 (W-12 follow-up) — `<hash>`** — `parseDnDId` runtime check uses a `const DND_KINDS = [...] as const` tuple as the single source of truth; `DnDIdKind` derives from `(typeof DND_KINDS)[number]`. Validation goes through an `isDnDIdKind` typeguard (`kind is DnDIdKind`) so the success-branch return continues to type-check. Adding a new DnD kind now requires one edit instead of two. `DND_KINDS` deliberately not exported — only the type is.
- **Commit 4 (N-1) — `<hash>`** — Three pointless `mutationFn` arrow wrappers removed: `mutationFn: (id: string) => deleteList(id)` → `mutationFn: deleteList` in `ListsPage.tsx`, `GearLibraryPage.tsx`, `ListDetailPage.tsx`. Other `mutationFn: (...) => ...` wrappers in the codebase capture closure values (userId, etc.) and are intentionally retained.
- **Commit 5 (N-3) — `<hash>`** — `WeightTable`'s `<tr>` key now uses a stable `row.id` (category id, or `'__uncategorized__'` sentinel for the Uncategorized row) instead of `row.name`. Two categories with the same name no longer collide on key. `WeightBreakdown.catRows` shape extended to include `id`.
- **Commit 6 (N-4) — `<hash>`** — `RowIconButton`'s `ACTIVE_CLASSES[variant]!` bang replaced with the `??` fallback form: `active ? (ACTIVE_CLASSES[variant] ?? VARIANT_CLASSES[variant]) : VARIANT_CLASSES[variant]`. Same rendered class set, no bang.

## Audit-stale closures (no commit needed)

- **N-2 — closed by prior change.** Audit recommended moving the `if (items.length === 0) return null` early-return to the top of `WeightTable`. The current shape (early-return after `useMemo` at `src/lists/WeightTable.tsx:78-83`) is correct and explicitly documented in the surrounding comment block — putting `return null` before `useMemo` would violate React hooks-order rules. The audit's framing assumed the math was expensive; for an empty `items` array the memoized `computeWeightBreakdown` returns near-instantly. No code change.
- **N-5 — explicitly deferred.** `csv.ts` 4-concern split is a substantial file restructure (~370 lines, 4 distinct surfaces); doesn't belong in a nit cluster. Bundle in a future refactor phase if pursued.
- **N-6 — closed by Phase 11.** Unused `attempt` counter in `withSlugRetry` was already addressed by Phase 11's W-3 commit (`75c6b77`), which switched the loop to a `1..=max` form with a referenced counter.

## Verification results

- `npm run build`: pass; bundle gzip 187.36 KB → <after> KB (delta ≈ 0; the W-2 dead-code removal saves a handful of bytes, the rest are no-runtime changes).
- `npm run lint`: pass at every commit.
- `npm test --run`: 32 passed | 4 skipped (unchanged from Phase 11). `WeightTable.test.ts` may need a row-shape update if it asserts deep-equal — handled in Commit 5.
- Manual smoke: pending user-side. Recommended:
  - Drag-reorder of items / cards / categories (W-2 verification — `assignSortOrderSlots` is exercised).
  - Pack-weight table on `/lists/<id>` renders correctly (N-3 verification).
  - Row icon buttons (`/lists`, `/gear`, kebabs) render identically across active/danger states (N-4 verification).
  - DnD on all surfaces still parses ids correctly (W-12 follow-up verification).

## Blockers / surprises

- (fill in or "none")

## Next phase

Phase 13 candidates (no clear winner — user picks):
- **W-6 standalone** — groupByCategory consolidation across `grouping.ts` / `SharePage.tsx` / `LibraryPanel.tsx`. Touches the Phase 5 stability layer; deserves its own phase with explicit per-site behavior verification.
- **Medium quality (UX-visible subset)** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort). User-felt fixes, separate review.
- **Medium quality (defensive subset)** — M-4 (crypto.randomUUID fallback), M-6 (Modal backdrop click simplification), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert), M-11 (parseDnDId comment refresh).
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install (a one-time tooling change).

After Phase 12, `REVIEW-quality.md` is substantially closed: every W- item except W-6 (Phase-5-coupled), every N- item except N-5 (file split, deferred). Remaining surface is the M- cluster (observable behavior changes) and the test-coverage cluster (tooling install).
```

**Suggested commit:** `docs(review-fix): append Phase 12 summary`

---

## Out of scope for Phase 12

Explicitly NOT in this phase:

- **W-6 (groupByCategory consolidation).** Touches the Phase 5 structural-stability layer; deserves its own phase.
- **N-2 (WeightTable early-return reorder).** Audit-stale — the current shape is correct per hooks-order rules. Documented as closed without a commit.
- **N-5 (csv.ts 4-concern split).** Substantial file restructure; doesn't belong in a nit cluster.
- **All M- items.** Each has observable behavior changes that warrant individual review.
- **slots[idx]! bang in `assignSortOrderSlots` (W-2 partial).** Audit explicitly justifies this bang; only the `.slice()` is in scope.
- **Other `mutationFn: (...) => ...` wrappers (N-1 partial).** All non-passthrough wrappers capture closure values (userId, listId, etc.) and are load-bearing. Only the three identified passthrough wrappers are in scope.
- **Exporting `DND_KINDS` (W-12 follow-up).** Tuple stays un-exported to avoid ballooning the surface; only the type is exported.

If a commit reveals scope expansion (e.g. W-9's per-file pointer surfaces a callsite that depends on the local docstring style, or N-3's row-shape change cascades into more sites than `WeightTable` itself), **stop and surface as a blocker** rather than rewriting the spec inline.
