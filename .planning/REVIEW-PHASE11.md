# grampacker — Phase 11 fixes (2026-05-05)

**Source:** `REVIEW-quality.md` — type-safety + correctness subset (W-3, W-5, W-8, W-10, W-11, W-12).
**Scope:** six small refactors with **two real correctness fixes** (W-10 DB-valid placeholder helper, W-11 sorted cache key) and four type-safety tightenings (W-3, W-5, W-8, W-12). Seven commits (one per refactor + docs).
**Why this is one phase:** all six items are mechanically small, individually low-value but collectively raise the type-safety floor. None require DB or wire-protocol changes. None alter user-visible behavior except the two correctness fixes (W-10 and W-11), and those are guardrails — they prevent latent bugs from surfacing rather than changing the happy path.

> **Note on file paths:** all paths are repo-relative.
> **Phase 10 baseline:** main bundle = **187.32 KB gzip**. Bundle delta expected: ≈ 0 (the W-10 helper extraction is a wash; W-12 keeps the `String(...)` call-site wrappers per Pattern A in this spec; the rest are type-only changes).
> **Risk profile:** very low. No behavior change at the happy path; type tightening will surface drift via `tsc -b` if any caller violates a tightened constraint.

> **Pure-stylistic items deferred to a future Phase 12:** W-2 (`assignSortOrderSlots` redundant `.slice()`) and W-9 (docstring hoist). They have no correctness payoff; bundling them here would dilute the theme.

---

## How to execute this file

Seven commits. Commit ordering is flexible; suggested order below groups type-system changes first (so any cascading lint/build errors land in one block) and the two correctness fixes (W-10, W-11) afterwards as standalone wins.

For each commit:
1. Make the change.
2. Run `npm run build` — pass (`tsc -b` is the verification of type-tightening commits; vite build covers regression).
3. Run `npm run lint` — pass.
4. Run `npm test --run` — 32 passed | 4 skipped (no test changes in this phase unless noted).
5. Manual smoke per the commit's verification section.

---

## Commit 1 — W-3: replace `(err as { code?: string })` soft-cast with `isPgUniqueViolation` typeguard

**Origin:** `REVIEW-quality.md` W-3 (Warning).

**Why:**

`src/lib/queries/lists.ts:11-23` reads:

```ts
async function withSlugRetry<T>(insert: (slug: string) => Promise<T>, max = 5): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < max; attempt++) {
    try {
      return await insert(generateSlug())
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code
      if (code !== '23505') throw err
      lastErr = err
    }
  }
  throw lastErr ?? new Error('slug generation: exhausted retries')
}
```

Two clarity issues: the `(err as { code?: string })` is a soft-cast that hides the protocol assumption (Supabase returns `PostgrestError` with a `.code` field); and the `lastErr ?? new Error(...)` fallback is unreachable — the loop sets `lastErr` on every iteration that doesn't `throw err`, and the only way to exit the loop without returning is by exhausting `max` attempts, which means `lastErr` is always set.

**Fix:** introduce a `isPgUniqueViolation(err): err is { code: string }` typeguard. Keep a defensive throw at the bottom for the `max ≤ 0` edge (a caller could pass it explicitly; the loop body wouldn't run, so `lastErr` would be undefined). Drop the `(err as { code?: string })` soft-cast.

**Files:**

- Modify: `src/lib/queries/lists.ts:11-23`

**What to do:**

```ts
function isPgUniqueViolation(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null
    && 'code' in err
    && (err as { code: unknown }).code === '23505'
}

async function withSlugRetry<T>(insert: (slug: string) => Promise<T>, max = 5): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await insert(generateSlug())
    } catch (err: unknown) {
      if (!isPgUniqueViolation(err)) throw err
      lastErr = err
    }
  }
  // Reachable when (a) `max` 23505 collisions in a row — astronomically
  // unlikely; or (b) caller passed `max <= 0` so the loop body never ran.
  // Keep the explicit Error fallback for case (b): without it, a stray
  // `withSlugRetry(fn, 0)` would `throw undefined`, which short-circuits
  // toast/error-handling that expects a real Error.
  throw lastErr ?? new Error('slug generation: exhausted retries')
}
```

The `1..=max` counter form makes the intent obvious (attempt 1 of N). Keeping the counter rather than `for (;;)` so a future debugger can read the attempt number.

**Verification:**

- Build + lint + tests pass.
- Manual smoke: not needed — pure refactor of the catch path. To exercise, force a slug collision by inserting a row with the same slug (impractical to test live; the regression is type/clarity).

**Acceptance criteria:** the `(err as { code?: string })` soft-cast is gone; the unreachable fallback is gone; behavior at the catch path is identical.

**Suggested commit:** `refactor(queries): tighten withSlugRetry catch with isPgUniqueViolation typeguard (W-3)`

---

## Commit 2 — W-5: remove `sort_order` from all four single-row update patch surfaces

**Origin:** `REVIEW-quality.md` W-5 (Warning).

**Why:**

Four call surfaces accept `sort_order` in their patch type today, even though every legitimate `sort_order` write goes through the `bulk_update_sort_order` RPC:

- `src/lib/queries/gear.ts:39` — `updateGearItem`'s patch parameter (inline `Partial<Pick<...>>`).
- `src/lib/queries/list-items.ts:81` — exported `ListItemPatch` type.
- `src/lib/queries/lists.ts:78` — `updateList`'s patch parameter (`'name' | 'description' | 'is_shared' | 'sort_order'`).
- `src/lib/queries/categories.ts:51` — `updateCategory`'s patch parameter (`'name' | 'sort_order'`).

A future caller could `editItem.mutate({ id, patch: { sort_order: 5 } })` (or the equivalent for any of the four) and bypass the bulk RPC entirely, writing a single-row sort_order update that desyncs the rest of the surface. Today no caller does this — verified by grep — but each type permits it.

**Fix:** remove `'sort_order'` from all four patch surfaces. Single-row sort_order writes were never the intent; the bulk RPC is the only sanctioned path. Doing all four in one commit keeps the audit ledger entry coherent and makes the "no single-row sort_order writes" rule a complete invariant rather than a partial one.

**Files:**

- Modify: `src/lib/queries/gear.ts:39` (`updateGearItem` patch).
- Modify: `src/lib/queries/list-items.ts:81` (exported `ListItemPatch` type).
- Modify: `src/lib/queries/lists.ts:78` (`updateList` patch).
- Modify: `src/lib/queries/categories.ts:51` (`updateCategory` patch).

**What to do:**

For each of the four files: drop `'sort_order'` from the `Pick<..., '...' | 'sort_order'>` union. Keep all other fields. Example for `updateList`:

```ts
// Before:
patch: Partial<Pick<List, 'name' | 'description' | 'is_shared' | 'sort_order'>>,
// After:
patch: Partial<Pick<List, 'name' | 'description' | 'is_shared'>>,
```

Apply the same shape to the other three.

### Verify no caller relied on the looser type

```sh
grep -rn "ListItemPatch\|updateGearItem(\|updateListItem(\|updateList(\|updateCategory(" src/ --include='*.tsx' --include='*.ts'
```

`ListItemPatch` is consumed by `CategoryGroup.tsx`, `ListDetailPage.tsx`. Confirm no call site assembles a patch object containing `sort_order` for any of the four functions. (Audit verified none does for gear/list-item; re-verify for `updateList` / `updateCategory` since this spec is broader than the original W-5 wording.)

**KNOWN RISK:** if `tsc -b` flags a type error after the tightening, that means a caller is currently passing `sort_order` through one of these surfaces — surface as a blocker rather than working around it. The whole point of this commit is to make that case visible.

**Verification:**

- Build + lint + tests pass.
- The grep in Step 3 returns zero offending callers.

**Acceptance criteria:** neither patch surface accepts `sort_order`; existing call sites still type-check.

**Suggested commit:** `refactor(queries): exclude sort_order from updateGearItem patch + ListItemPatch (W-5)`

---

## Commit 3 — W-8: replace `category!` non-null assertions with branch narrowing

**Origin:** `REVIEW-quality.md` W-8 (Warning).

**Why:**

Five `category!` non-null assertions across two files:

- `src/lists/ListDetailPage.tsx:844-846` — three bangs in JSX (`group.category!.id`, `group.category!.name`, `group.category!.id`).
- `src/gear/CategorySection.tsx:153, 162` — two bangs in handlers (`category!.name`, `category!`).

Each is mechanically correct today (the surrounding code has narrowed the case where `category` could be null), but the bang is fragile to a future refactor that drops the narrowing. Branch-narrowing produces the same runtime behavior and gets the type-narrowing for free.

**Files:**

- Modify: `src/lists/ListDetailPage.tsx:844-846`
- Modify: `src/gear/CategorySection.tsx:153, 162`

**What to do:**

### Step 1 — read each site to confirm the surrounding narrowing

For each bang, read 5–10 lines around it to find what already establishes that `category` is non-null. Common shapes:

- A surrounding `if (!group.category) return null` (or similar) earlier in the component.
- A `.filter((g) => g.category !== null)` upstream that should have narrowed the type if it weren't for TS not following array-filter narrowing.

If the existing narrowing is via a `.filter` that TS doesn't follow: extract the narrowed array into a typed variable using a typeguard in the filter callback, e.g.:

```ts
function hasCategory(g: GroupedRow): g is GroupedRow & { category: Category } {
  return g.category !== null
}

const grouped = rawGrouped.filter(hasCategory)
// grouped is now GroupedRow & { category: Category }[] — no bang needed below.
```

If the existing narrowing is an `if/return` guard, no helper needed — just remove the `!` after the guard.

### Step 2 — apply the change at each site

For `ListDetailPage.tsx:844-846`:

```tsx
// Before (illustrative):
{groupedWithCategory.map((group) => (
  <CategoryGroup
    key={group.category!.id}
    name={group.category!.name}
    categoryId={group.category!.id}
    ...
  />
))}

// After (illustrative — depends on which narrowing shape applies):
{groupedWithCategory.map((group) => (
  group.category && (
    <CategoryGroup
      key={group.category.id}
      name={group.category.name}
      categoryId={group.category.id}
      ...
    />
  )
))}
```

If the upstream filter approach is cleaner (avoids the inline `&&`), prefer that. Either is acceptable; both eliminate the bang.

For `CategorySection.tsx:153, 162` — the bangs are inside event handlers, so the surrounding closure already has access to a narrowed `category` if the component renders only when `category` is non-null. If `category` is a prop, type the prop as non-null at the component boundary:

```ts
// Before:
function CategoryRow({ category }: { category: Category | null }) {
  ...
  setRenameDraft(category!.name)
  onClick={() => onDeleteCategory(category!)}
  ...
}

// After:
function CategoryRow({ category }: { category: Category }) {  // tightened prop
  ...
  setRenameDraft(category.name)
  onClick={() => onDeleteCategory(category)}
  ...
}
```

If the caller passes `null` and the existing render handles that case via a parent guard, push the guard up to the parent and tighten the prop.

**KNOWN RISK:** the right shape depends on what's currently narrowing each site. Read 5–10 lines around each bang before applying. If any site reveals the bang was actually load-bearing (i.e. the type isn't currently narrowed), surface as a blocker — that means the existing code has a latent runtime hazard that the bang was hiding, and the fix is bigger than a mechanical replacement.

**Verification:**

- Build + lint + tests pass. `tsc -b` is the primary check; if it surfaces a type error, the spot needs the upstream-narrowing extraction described in Step 1.
- Manual smoke:
  1. `/lists/<id>` — pack-mode and inline edit on category groups render normally.
  2. `/gear` — category rename and delete still work.

**Acceptance criteria:** no `category!` bangs in `src/lists/ListDetailPage.tsx` or `src/gear/CategorySection.tsx`. Behavior unchanged.

**Suggested commit:** `refactor(types): replace category! non-null assertions with branch narrowing (W-8)`

---

## Commit 4 — W-10: extract `optimisticListPlaceholder` helper with DB-valid placeholder shapes

**Origin:** `REVIEW-quality.md` W-10 (Warning, real correctness risk).

**Why:**

Three sites construct optimistic-list rows with `temp-${crypto.randomUUID()}` placeholders for both `id` and `slug`:

- `src/lists/ListsPage.tsx:127, 131`
- `src/lists/ListsEmptyState.tsx:65, 69`
- `src/layout/ListSelector.tsx:158, 162`

(One more site, `src/lists/ListDetailPage.tsx:230-231`, constructs only an id placeholder for an optimistic list-**item** — different shape, no slug column. Out of scope for this helper; left alone.)

Two correctness problems with the current shape:

1. **Slug:** `lists.slug` has a `char_length(slug) = 6` CHECK. `temp-${randomUUID()}` is ~41 chars. If the optimistic row ever leaks to the DB (a future refactor that accidentally persists optimistic state), the INSERT fails with `23514 check_violation`.
2. **Id:** `lists.id` is `uuid` typed. `temp-${randomUUID()}` is a string, not a valid uuid. If it leaked, the INSERT fails with `22P02 invalid_text_representation`.

The audit's framing "would fail DB CHECK if leaked" addresses problem 1 but misses problem 2. **And the audit's proposed helper would still emit invalid placeholders** — centralizing an invalid shape doesn't reduce the underlying risk.

**Fix:** the helper emits **DB-valid** placeholders so a leak fails-soft (the row just doesn't replace anything, no constraint violation). `crypto.randomUUID()` for the id (valid uuid v4, won't collide with a real id at any practical scale), `generateSlug()` for the slug (the same 6-char generator the server uses, satisfies the CHECK). The helper documents the never-persisted intent inline; a leak is now silently survivable instead of a 23514/22P02.

**Files:**

- Create: `src/lib/optimistic-list-placeholder.ts`
- Modify: `src/lists/ListsPage.tsx:127, 131`
- Modify: `src/lists/ListsEmptyState.tsx:65, 69`
- Modify: `src/layout/ListSelector.tsx:158, 162`

**What to do:**

### Step 1 — write the helper

```ts
// src/lib/optimistic-list-placeholder.ts
import type { List } from './types'
import { generateSlug } from './slug'

// Build an optimistic row that satisfies the List shape for cache-write
// purposes during list creation.
//
// The placeholder uses DB-VALID values for `id` (random uuid v4) and
// `slug` (6-char generator matching the server's slug). The intent is
// still that the server response replaces this row before settle —
// but if that contract is ever broken (e.g. a future refactor that
// accidentally persists the optimistic state), a leak fails soft:
// the row just doesn't replace anything, no 23514 CHECK violation, no
// 22P02 invalid uuid. UUID-vs-real-id collision is astronomically
// unlikely.
//
// Usage:
//   qc.setQueryData<List[]>(['lists'], (prev) => [
//     ...(prev ?? []),
//     optimisticListPlaceholder({ name, userId, sortOrder }),
//   ])
export function optimisticListPlaceholder(args: {
  name: string
  userId: string
  sortOrder: number
  description?: string | null
}): List {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    user_id: args.userId,
    name: args.name,
    description: args.description ?? null,
    slug: generateSlug(),
    sort_order: args.sortOrder,
    is_shared: false,
    created_at: now,
    updated_at: now,
  }
}
```

**Read `src/lib/types.ts` first** to confirm the `List` shape — if additional required fields exist, add them with sensible defaults.

### Step 2 — convert all three call sites

For each of `ListsPage.tsx`, `ListsEmptyState.tsx`, `ListSelector.tsx`:

```ts
// Before (illustrative):
const optimistic = {
  id: `temp-${crypto.randomUUID()}`,
  user_id: userId,
  name,
  description: <local|null>,
  slug: `temp-${crypto.randomUUID()}`,
  sort_order: <sortOrder>,
  is_shared: false,
  created_at: now,
  updated_at: now,
}

// After:
const optimistic = optimisticListPlaceholder({ name, userId, sortOrder, description })
```

Each site has slightly different surrounding context (one is inside a mutation `optimistic` callback, another inside an `onMutate` rollback closure, etc.). Read 5–10 lines around each before replacing — preserve the surrounding flow exactly.

### Step 3 — confirm grep is clean

```sh
grep -rn 'temp-\${crypto\.randomUUID' src/ --include='*.tsx' --include='*.ts'
```

After the change, the only surviving hits should be in `src/lists/ListDetailPage.tsx` (the id-only list-item placeholder, intentionally NOT migrated). Three list-row sites should be gone.

**KNOWN RISK:** the helper now emits a real uuid as the id. If any code path keys behavior off `id.startsWith('temp-')` (e.g. "this row is optimistic, don't run X"), that key is gone and the behavior breaks. Audit before this change: `grep -rn "temp-" src/ --include='*.tsx' --include='*.ts'`. If any branch reads optimistic-ness from the prefix, surface as a blocker — the right fix is to use a separate optimistic-flag field, not a string-prefix sniff.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. `/lists` — create a new list. Optimistic card appears immediately, then resolves to the real card on server response.
  2. `/lists` (zero-state) — name-and-create flow on `ListsEmptyState`. Same.
  3. Hard-refresh after each create. Confirm the persisted row has the server-generated 6-char slug, not `temp-...`.

**Acceptance criteria:** `temp-${crypto.randomUUID()}` no longer appears in `ListsPage.tsx` or `ListsEmptyState.tsx`. The helper is the single source for optimistic-list construction.

**Suggested commit:** `refactor(lists): centralize optimistic placeholder in optimisticListPlaceholder helper (W-10)`

---

## Commit 5 — W-11: sorted cache key for `fetchSharedListCategories`

**Origin:** `REVIEW-quality.md` W-11 (Warning, real cache-key bug).

**Why:**

`src/lists/SharePage.tsx:42`:

```ts
queryKey: ['shared-list-categories', list?.id, categoryIds.join(',')],
queryFn: () => fetchSharedListCategories(categoryIds),
```

`categoryIds` comes from a list-items array — its order depends on the order items appear in the list. Two renders that produce semantically-identical sets of category ids in different orders (e.g. after reorder, or across two devices viewing the same shared list) will produce different cache keys and force a refetch.

**Fix:** sort the ids before joining. `[...categoryIds].sort().join(',')` is order-independent for any input that produced the same set.

**Files:**

- Modify: `src/lists/SharePage.tsx:42`

**What to do:**

```ts
// Before:
queryKey: ['shared-list-categories', list?.id, categoryIds.join(',')],

// After:
queryKey: ['shared-list-categories', list?.id, [...categoryIds].sort().join(',')],
```

The spread is necessary — `Array.prototype.sort` mutates in place; without the spread we'd reorder `categoryIds` and side-effect any downstream consumer. The sort is lexicographic on uuid strings, which is fine: only sort stability across renders matters here, not sort key meaning.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. Open a shared list at `/r/<slug>`. Confirm categories render correctly.
  2. Reload — confirm no stale-data flash and no extra refetch (open DevTools Network → only one `fetchSharedListCategories` per session under steady state).

**Acceptance criteria:** the cache key sorts the ids before joining; existing render behavior preserved.

**Suggested commit:** `fix(share): sort categoryIds in cache key to make fetchSharedListCategories order-independent (W-11)`

---

## Commit 6 — W-12: tighten `parseDnDId` to `(raw: string)`

**Origin:** `REVIEW-quality.md` W-12 (Warning).

**Note on scope:** the audit's W-12 also suggests "Use a const tuple for `KINDS`" to replace the inline `kind !== 'category' && kind !== 'gear-item' && ...` chain in the body. **Explicitly deferred** in this commit — the inline chain is correct and only four kinds long; converting to `const KINDS = ['category', 'gear-item', 'item', 'list-card'] as const` and `if (!KINDS.includes(kind as ...)) return null` is a stylistic improvement with no correctness payoff. Bundle with W-2 / W-9 in a future Phase 12 nit cluster.

**Why:**

`src/lib/dnd-ids.ts:33-46`:

```ts
export function parseDnDId(
  raw: string | number,
): { kind: DnDIdKind; id: string } | null {
  if (typeof raw !== 'string') return null
  ...
}
```

The function accepts `string | number`, then immediately rejects all numbers. Every call site already wraps with `String(active.id)` (the dnd-kit `Active.id` type is `UniqueIdentifier = string | number`, but the codebase exclusively uses string ids). Tightening the parameter to `string` and dropping the `String(...)` wrappers at call sites collapses the dance.

**Files:**

- Modify: `src/lib/dnd-ids.ts:33-46` (parameter type + body)
- Modify: callers — `src/lists/ListsPage.tsx:203-204, 305`, `src/lists/ListDetailPage.tsx:497-498, 824`, `src/gear/GearLibraryPage.tsx:400, 405, 456-457` (drop the `String(...)` wrappers, OR keep them as defense-in-depth — pick one consistently).

**What to do:**

### Step 1 — tighten the parameter

```ts
// Before:
export function parseDnDId(
  raw: string | number,
): { kind: DnDIdKind; id: string } | null {
  if (typeof raw !== 'string') return null
  const idx = raw.indexOf(':')
  ...

// After:
export function parseDnDId(
  raw: string,
): { kind: DnDIdKind; id: string } | null {
  const idx = raw.indexOf(':')
  ...
```

Drop the `if (typeof raw !== 'string') return null` line — TS now enforces it.

### Step 2 — convert callers

dnd-kit's `Active.id` is `string | number` (`UniqueIdentifier`). After the tightening, callers must pass a string. There are two reasonable patterns:

**Pattern A (preferred — explicit at the call site):** keep the `String(...)` wrapper everywhere. The wrapper is now load-bearing for type-correctness instead of dead defensive code.

```ts
const activeParsed = parseDnDId(String(active.id))
```

**Pattern B (drop wrappers, rely on the codebase invariant):** every id in this codebase is a string (via `makeDnDId`). Drop `String(...)` at the four DnD-event sites. The TS compiler will surface any future use-of-numeric-id at lint time.

Pattern A keeps the wrappers as defense; Pattern B trusts the invariant (which the comment block in `dnd-ids.ts:23` already asserts: "every id in this codebase is a uuid"). **Recommendation: Pattern A.** The runtime cost of `String(...)` is negligible and it documents the type cast at the call site instead of forcing a reader to chase the dnd-kit type.

### Step 3 — confirm zero `parseDnDId(<number>)` calls

```sh
grep -rn "parseDnDId(" src/ --include='*.tsx' --include='*.ts'
```

Every call must be `parseDnDId(<string>)` after the tightening. If any call passes a raw `active.id` (which is `string | number`), TS will surface it.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. `/lists` — drag-reorder list cards.
  2. `/lists/<id>` — drag-reorder list items within a category.
  3. `/gear` — drag-reorder gear items and drag-reorder categories.
  All three should behave identically to before.

**Acceptance criteria:** `parseDnDId` accepts only `string`. The dead `if (typeof raw !== 'string') return null` line is gone. All call sites compile; behavior unchanged.

**Suggested commit:** `refactor(dnd): tighten parseDnDId parameter to string-only (W-12)`

---

## Commit 7 — Append Phase 11 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

```markdown
# grampacker — Phase 11 fix summary (2026-05-05)

## Shipped

- **Commit 1 (W-3) — `<hash>`** — `withSlugRetry` in `src/lib/queries/lists.ts` now uses an `isPgUniqueViolation(err)` typeguard instead of an `(err as { code?: string })` soft-cast. The defensive `throw lastErr ?? new Error('exhausted retries')` is retained — reachable when a caller passes `max ≤ 0` (the loop body never runs, so `lastErr` would be undefined without the fallback). Closes N-6 (unused counter) as a side effect via the `1..=max` counter form.
- **Commit 2 (W-5) — `<hash>`** — `sort_order` removed from all four single-row update patch surfaces: `updateGearItem` (`gear.ts`), `ListItemPatch` (`list-items.ts`), `updateList` (`lists.ts`), `updateCategory` (`categories.ts`). Single-row `sort_order` writes were never the intent; `bulk_update_sort_order` is the only sanctioned path. The audit's original W-5 wording named only the gear/list-item surfaces; broadened here to make the "no single-row sort_order writes" rule a complete invariant.
- **Commit 3 (W-8) — `<hash>`** — Five `category!` non-null assertions replaced with branch narrowing (3 in `src/lists/ListDetailPage.tsx:844-846`, 2 in `src/gear/CategorySection.tsx:153, 162`). Branch narrowing established via prop tightening or upstream typeguarded filters.
- **Commit 4 (W-10) — `<hash>`** — `optimisticListPlaceholder` helper added in `src/lib/optimistic-list-placeholder.ts`. Three sites converted (`ListsPage.tsx`, `ListsEmptyState.tsx`, `ListSelector.tsx`). The helper now emits **DB-valid** placeholders — `crypto.randomUUID()` for the `lists.id` uuid column and `generateSlug()` for the `slug` 6-char-CHECK column — so a future leak fails soft instead of hitting a 23514 CHECK violation or a 22P02 invalid-uuid error. The id-only optimistic placeholder in `ListDetailPage.tsx:230-231` (for list-items, not lists) is intentionally NOT migrated.
- **Commit 5 (W-11) — `<hash>`** — `fetchSharedListCategories` cache key in `src/lists/SharePage.tsx:42` now sorts ids before joining: `[...categoryIds].sort().join(',')`. Renders that produce the same set of category ids in different orders now share a cache entry instead of forcing a refetch.
- **Commit 6 (W-12) — `<hash>`** — `parseDnDId` parameter tightened from `string | number` to `string` in `src/lib/dnd-ids.ts:33-46`. Dead `if (typeof raw !== 'string') return null` body line removed. All call sites kept their `String(...)` wrappers for explicit type documentation at the call site (Pattern A from the spec — Pattern B / drop-the-wrappers is the alternative). The `KINDS` const-tuple suggestion from the audit is explicitly deferred to a future stylistic-nits phase.

## Verification results

- `npm run build`: pass; bundle gzip 187.32 KB → <after> KB (delta ≈ 0; the type-only commits add no runtime, the W-10 helper is a wash).
- `npm run lint`: pass.
- `npm test --run`: 32 passed | 4 skipped (unchanged from Phase 10).
- Manual smoke: pending user-side. Recommended:
  - DnD reorder still works on `/lists` (cards), `/lists/<id>` (items within category), `/gear` (items and categories).
  - List create flow on `/lists` and zero-state `/lists` (`ListsEmptyState`) shows optimistic card → real card transition cleanly.
  - Shared list at `/r/<slug>` renders categories correctly; no extra refetch under steady state.

## Blockers / surprises

- (fill in or "none")

## Next phase

Phase 12 candidates (no clear winner — user picks):
- **Pure-stylistic micro-refactors** — W-2 (`assignSortOrderSlots` redundant `.slice()`), W-9 (docstring hoist). Two trivial commits, zero correctness payoff. Bundle with N- nits if pursued.
- **W-6 standalone** — groupByCategory consolidation. Touches the Phase 5 stability layer; deserves its own phase with explicit per-site behavior verification.
- **Medium quality** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert).
- **F4 full path** — only if the threat model changes. SECURITY DEFINER `fetch_shared_list(p_slug)` RPC + revoke anon SELECT + four-policy reshape.
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install (a one-time tooling change).

After Phase 11, `REVIEW-quality.md` is substantially closed on the W- side: W-1, W-3, W-4, W-5, W-7, W-8, W-10, W-11, W-12, W-13 done. Remaining W- items: W-2 (pure nit), W-6 (Phase-5-coupled), W-9 (pure nit). M- and B- items are either accepted (B-1..3 shipped) or pending separate phases.
```

**Suggested commit:** `docs(review-fix): append Phase 11 summary`

---

## Out of scope for Phase 11

Explicitly NOT in this phase:

- **W-2 (`assignSortOrderSlots` redundant `.slice()`).** Pure stylistic, no correctness payoff. Defer to a future Phase 12 nit cluster.
- **W-9 (docstring hoist for "Owner-scoped private read").** Same — pure stylistic.
- **W-6 (groupByCategory consolidation).** Touches the Phase 5 structural-stability layer; deserves its own phase with per-site verification. Bundling here would dilute scope.
- **All M- items.** Each has observable behavior changes (M-1 production logging, M-2 stale `updated_at`, etc.) that warrant individual review per item.
- **N- items (`mutationFn: deleteList` over `(x) => deleteList(x)` etc.).** Pure stylistic; bundle later if desired.
- **Runtime guard against optimistic placeholder persistence.** W-10's helper centralizes the construction; adding a `slug.startsWith('temp-')` guard inside `createList` would be defense-in-depth but is out of scope.
- **Pattern B for W-12 (drop `String(...)` wrappers).** Pattern A keeps the wrappers for explicit type documentation; Pattern B is the alternative. Stick to A unless surfaced.
- **`KINDS` const tuple in `parseDnDId`.** Audit suggested replacing the inline `kind !== 'category' && kind !== 'gear-item' && ...` chain with `const KINDS = [...] as const`. Stylistic-only; deferred to the W-2/W-9 nit cluster.
- **id-only optimistic placeholders in `ListDetailPage.tsx`.** The helper in W-10 is list-specific. List-item placeholders have a different shape and no slug constraint; leave alone.
- **Runtime guard against optimistic placeholder persistence.** Considered for W-10 — a `slug.startsWith('temp-')` check inside `createList` was floated, but the DB-valid placeholder approach makes a guard unnecessary (a leak fails soft rather than fails hard). No guard needed.

If a commit reveals scope expansion (e.g. W-8's branch narrowing surfaces a real latent null hazard the bang was hiding, or W-5's tightening surfaces a caller currently passing `sort_order`), **stop and surface as a blocker** rather than rewriting the spec inline.
