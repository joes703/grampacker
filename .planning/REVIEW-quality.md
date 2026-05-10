# grampacker — whole-codebase code quality review (2026-05-04)

Read: `CLAUDE.md`, `DECISIONS.md`, `SECURITY.md`, all of `src/`, every migration in `supabase/migrations/`. The codebase is in good shape overall — most of the convergence work CLAUDE.md mandates has actually landed (one bulk RPC for the four reorderable tables, one optimistic helper family, one `usePortalPopover` hook used by all five popovers, comments mostly explain *why*).

The defects below are mostly correctness bugs in narrow paths, plus duplication and type holes the migration trail left behind.

Severity tiers: **BLOCKER** = correctness/security; **WARNING/MEDIUM/LOW** below; **NIT** = stylistic.

---

## BLOCKER

### B-1 — `WeightTable` silently drops base weight when an item references a category not in `categories`

**`src/lists/WeightTable.tsx:25-45`**

`groupListItemsByCategory` already treats unknown category ids as Uncategorized (`src/lib/grouping.ts:28-30`). `WeightTable` does not. It accumulates per-cat grams keyed on the raw `item.gear_item.category_id`, then iterates `categories` and only emits rows where `basePerCat.has(c.id)`. An item whose `category_id` is non-null but not present in the passed-in `categories` accumulates under that orphan key, is never read, never summed into `baseGrams`. The item shows up under "Uncategorized" in the items list but its weight vanishes from "Base weight" / "Total pack weight".

Trigger: cache drift between `['categories']` and `['list-items']` (open window after a category delete; `gear_item` join projection caches `category_id` until next list-items refetch). Also trips on the share view if `fetchSharedListCategories` returns a strict subset for any reason.

Why it matters: total pack weight is the headline number this app exists to compute. Silently wrong is worse than crashing.

Fix:
```ts
for (const item of items) {
  const w = item.gear_item.weight_grams * item.quantity
  if (item.is_consumable) consumableGrams += w
  else if (item.is_worn) wornGrams += w
  else {
    const raw = item.gear_item.category_id
    const key = raw !== null && categories.some((c) => c.id === raw) ? raw : null
    basePerCat.set(key, (basePerCat.get(key) ?? 0) + w)
  }
}
```
There's no test for `WeightTable` at all.

### B-2 — `editItem` category change leaves embedded `gear_item.category_id` stale until refetch, which corrupts subsequent reorder

**`src/gear/GearLibraryPage.tsx:218-232`, `src/lists/ListDetailPage.tsx:301-311`**

Both `editItem` mutations write optimistically to `['gear-items']` and broadly invalidate `['list-items']` on settled. For `name`/`description`/`weight_grams` that's fine. For `category_id` it isn't: while the round-trip is in flight, `groupListItemsByCategory` reads the stale embedded value, so the item visually stays in its old category. If the user moves item X from Cat A → Cat B in the dialog and immediately reorders within Cat B before settled, `arrayMove` sees X as still in Cat A and `assignSortOrderSlots` rewrites the wrong category's slots. Optimistic UI then hides the server's truth and the user sees "looks reordered fine" until refresh — at which point sort_order is wrong.

Fix options: (a) optimistic fan-out across every `['list-items', listId]` cache that contains this gear id, rewriting embedded `category_id`; (b) gate per-category `SortableContext` on `editItem.isPending`; (c) at minimum, document the race AND disable the drag handles for that gear's items during edit. (a) is cleanest but requires extending the helper.

### B-3 — `ListDetailPage.deleteGearItemMut` skips the optimistic helper, behaving differently from `GearLibraryPage.removeItem` which does the same operation

**`src/lists/ListDetailPage.tsx:316-322`**

```ts
const deleteGearItemMut = useMutation({
  mutationFn: (id: string) => deleteGearItem(id),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    qc.invalidateQueries({ queryKey: ['list-items'] })
  },
})
```

`GearLibraryPage.removeItem` (other entry point for "Delete from inventory") goes through `makeOptimisticDelete<GearItem, string>` and gets local optimistic delete + side-cache invalidation + rollback toast on error. The list-page flavor doesn't. User taps row kebab → "Delete from inventory" and the item lingers in both gear and list views until the round-trip lands. Two entry points for the same destructive action behave differently. Also: `mutationFn: (id) => deleteGearItem(id)` is a pointless wrapper.

Fix: replace with the same helper shape `GearLibraryPage.removeItem` uses (`src/gear/GearLibraryPage.tsx:234-244`).

### B-4 — `bulkDelete` and `bulkMove` on `/gear` skip optimistic UI AND have no `onError` toast, so a failed bulk action is invisible

**`src/gear/GearLibraryPage.tsx:246-255`**

```ts
const bulkDelete = useMutation({
  mutationFn: (ids: string[]) => bulkDeleteGearItems(ids),
  onSuccess: () => { invalidateItems(); invalidateListItems(); exitSelectMode() },
})
```

A 50-item bulk delete waits silently for the round-trip with no UI feedback, then everything blinks at once. If the server rejects (RLS, constraint, network), `onSuccess` doesn't fire, `exitSelectMode` doesn't run, no toast surfaces — user is left in select mode with a stale UI and no error state. Same shape on `bulkMove`. At minimum add `onError` with a toast; ideally extend the helper family with a `makeOptimisticBulkDelete` / `BulkUpdate`.

`bulkMove` also has the B-2 problem at scale: it changes `category_id` for many gear items but only coarsely invalidates caches.

---

## WARNING

### W-1 — Three duplicate kebab implementations around `usePortalPopover`

**`src/lists/ItemRow.tsx:463-537`, `src/gear/GearItemRow.tsx:150-204`, `src/lists/ListsPage.tsx:537-676`**

Each owns `useState<{top, left}>`, `triggerRef`, `menuRef`, `usePortalPopover`, an `openMenu()` doing the same `getBoundingClientRect()` + `Math.max(8, rect.right - menuWidth)` math, and a `createPortal(<div className="fixed z-50 w-XX rounded-lg border border-gray-200 bg-white py-1 shadow-lg" style={{top, left}}>…)`. Only the menu items differ. CLAUDE.md explicitly mandates the *dismiss listeners* go through `usePortalPopover` — but the *positioning + portal + state* boilerplate around it was never extracted, so each kebab still owns ~30 lines of identical scaffolding.

Fix: extract `useAnchoredMenu({ align: 'right-flush' | 'right-of-trigger', menuWidth })` returning `{ open, openMenu, closeMenu, triggerRef, menuRef, menuStyle }`. Each kebab collapses to ~10 lines. Saves ~120 lines.

### W-2 — `assignSortOrderSlots` uses `slots[idx]!` and `.slice().sort()` is redundant

**`src/lib/grouping.ts:64-71`**

The bang is justified ("identical length by construction"). But `.map(...).slice().sort()` is overcomplicated: `.map()` already returns a fresh array; `.slice()` is dead.

### W-3 — `withSlugRetry` soft-cast `(err as { code?: string })` and unreachable fallback

**`src/lib/queries/lists.ts:11-23`**

The `lastErr ?? new Error('exhausted retries')` fallback at the end is unreachable. A small `isPgUniqueViolation(err): err is { code: string }` guard would be clearer.

### W-4 — Triple `userId` resolution pattern: `?? ''` + later `if (!session) return null`

**`src/lists/ListDetailPage.tsx:96-105`, `src/lists/ListsPage.tsx:81-82, 238`, `src/layout/RootRedirect.tsx:16`**

Each does `userId = session?.user.id ?? ''` and later `if (!session) return null`. Two checks for the same condition. Cleanest: `useRequireSession()` helper returning `{ session, userId } | null` collapses three near-identical boilerplate blocks. `GearLibraryPage.tsx:79-80` and `ListsEmptyState.tsx:26` use the opposite pattern (`session!.user.id`); the codebase is half-and-half.

### W-5 — `updateGearItem` and `updateListItem` patch types include `sort_order`, allowing out-of-band single-row sort_order writes

**`src/lib/queries/gear.ts:39`, `src/lib/queries/list-items.ts:81`**

A future caller could `editItem.mutate({ id, patch: { sort_order: 5 } })` and bypass the bulk RPC. Today no caller does, but the type permits it.

```ts
type GearPatch = Partial<Pick<GearItem, 'name' | 'description' | 'weight_grams' | 'category_id' | 'cost' | 'purchase_date'>>
```

### W-6 — Three `groupBy(category)` implementations, two of which inline reproduce `groupListItemsByCategory`

**`src/lib/grouping.ts:14-34`, `src/lists/SharePage.tsx:82-96`, `src/lists/LibraryPanel.tsx:55-60`**

Three places to drift independently. Fix: parameterize `groupByCategory(items, categories, getCategoryId, { keepEmpty })`.

### W-7 — `LibraryPanel`'s inline `CategoryGroup` shadows the public `lists/CategoryGroup`

**`src/lists/LibraryPanel.tsx:121`**

There's already a `CategoryGroup` exported from `src/lists/CategoryGroup.tsx`. Rename the local to `LibraryCategoryGroup` or `GearPickerGroup`.

### W-8 — `category!` non-null assertions in three sites, all replaceable with branch-narrowing

**`src/gear/CategorySection.tsx:151, 160`, `src/lists/ListDetailPage.tsx:673-679`**

Mechanically correct, but TS-fragile. Replace with explicit narrowing.

### W-9 — Four near-identical "Owner-scoped private read" docstrings

**`src/lib/queries/categories.ts:5-9`, `gear.ts:7-11`, `lists.ts:25-29`, `list-items.ts:7-11`**

All four read identically. Hoist to one paragraph in `index.ts`.

### W-10 — `temp-${crypto.randomUUID()}` placeholder slugs would fail the `char_length(slug) = 6` CHECK if they ever leaked to the DB

**Seven sites**, e.g., `ListsPage.tsx:127`, `ListsEmptyState.tsx:69`, `ListSelector.tsx:194`.

Today they don't leak; the prefix is a real regression risk. One helper `optimisticListPlaceholder(name, userId, sortOrder)` would centralize.

### W-11 — `fetchSharedListCategories` cache key uses unsorted `categoryIds.join(',')`

**`src/lists/SharePage.tsx:34`**

Use `[...categoryIds].sort().join(',')`.

### W-12 — `parseDnDId` accepts `string | number` then immediately rejects numbers

**`src/lib/dnd-ids.ts:33-46`**

Every callsite already wraps with `String(active.id)`. Tighten to `parseDnDId(raw: string)`. Use a const tuple for `KINDS`.

### W-13 — `parseGearCsv` doesn't bound the upper end of `cost`, but the DB caps at `numeric(10,2)`

**`src/lib/csv.ts:247-254`**

A CSV with `cost,99999999999.99` passes `parseCost`, then fails at `INSERT` with 22003 numeric_value_out_of_range, taking the whole batch with it.

```ts
return Math.min(Math.round(n * 100) / 100, 99_999_999.99)
```

---

## MEDIUM

### M-1 — `App.tsx` `MutationCache.onError` is dev-only `console.error`; production has zero observability for silent mutation failures

**`src/App.tsx:21-32`**

A mutation that fails AND the call site forgot `onError` AND optimistic rollback is silent → completely unobserved in prod.

### M-2 — Optimistic apply doesn't bump `updated_at`, so the lists card grid shows stale "Updated Xm ago" until refetch

**`src/lists/ListDetailPage.tsx:284-292`** (notesMut), **`src/lists/ListsPage.tsx:143-151`** (renameMut), **`src/layout/NavBar.tsx:202-210`** (rename in heading).

```ts
apply: (item, description) => ({
  ...item,
  description: description || null,
  updated_at: new Date().toISOString(),
}),
```

### M-3 — `ListSelector` opens both the desktop popover and the Vaul drawer when `isMobile` flips mid-open

**`src/layout/ListSelector.tsx:55-79`**

Force-close on `isMobile` flip.

### M-4 — `crypto.randomUUID()` unconditional, no fallback for non-secure contexts

`vite preview` over plain HTTP plus older Safari versions hit "crypto.randomUUID is not a function". A `randomTempId()` helper covers it without dragging in a polyfill.

### M-5 — `useCsvFileInput` doesn't handle `FileReader.error` / `.onabort`

**`src/lib/use-csv-file-input.ts:38-50`**

Add `reader.onerror` and `reader.onabort` calling `handlers.onError(...)`.

### M-6 — `Modal` backdrop click does redundant rect arithmetic

**`src/components/Modal.tsx:44-57`**

Simplify to `if (e.target === e.currentTarget) e.currentTarget.close()`.

### M-7 — `RootRedirect` re-sorts every list on every render to find max-by `updated_at`

**`src/layout/RootRedirect.tsx:28-31`**

`.reduce<List | null>((best, l) => ...)` is one line.

### M-8 — Five sites repeat `gearItems.find(...)` / `listItems.find(...)` lookups

**`src/lists/ListDetailPage.tsx:486-494, 488-489, 551-552`**

`useMemo(() => new Map(gearItems.map(g => [g.id, g])), [gearItems])` once per query, then `gearById.get(id)` everywhere.

### M-9 — `sharedGroupProps` `useMemo` recomputes on every `gearItems`/`listItems` change

**`src/lists/ListDetailPage.tsx:471-498`**

Today no harm; flagging for the next person who tries to memoize CategoryGroup.

### M-10 — Shared `is_consumable` + `is_worn` mutual exclusion is enforced at the DB but the WeightTable branch order silently picks consumable

**`src/lists/WeightTable.tsx:27-34`**

Document the precedence or assert.

### M-11 — `parseDnDId`'s comment claims uuids never contain colons

Defensible today, but the format is fragile to a future change.

---

## LOW / NIT

- **N-1 — Pointless `mutationFn: (x) => fn(x)` wrappers** — `src/lists/ListsPage.tsx:162`, `src/lists/ListDetailPage.tsx:317`, several others. `mutationFn: deleteList` is equivalent.
- **N-2 — `WeightTable.tsx`'s `if (items.length === 0) return null` runs after the math** — move it to the top.
- **N-3 — `WeightTable` uses `name` as React key** — two categories with the same name collide; categories aren't `UNIQUE(user_id, name)`. Use `category.id`.
- **N-4 — `RowIconButton.tsx:57`'s `ACTIVE_CLASSES[variant]!` is gated by a truthy check above it** — replace with `?? VARIANT_CLASSES[variant]`.
- **N-5 — `csv.ts` is ~370 lines with 4 distinct concerns** (parse, stringify, gear format, list format).
- **N-6 — `withSlugRetry`'s loop counter `attempt` is unused** — `for (;;)` with explicit attempt counter is more honest.
- **N-7 — `main.tsx:6` `document.getElementById('root')!`** — same as every Vite scaffold.

---

## Test coverage gaps

### T-1 — `WeightTable` has no test, including the B-1 orphan-category path

Total pack weight is the load-bearing computation. Test ideas: orphan category id contributes to base, `quantity * weight_grams` math, empty items returns null.

### T-2 — `groupListItemsByCategory` and `groupGearItemsByCategory` are untested

The comments at `grouping.ts:13-14` and `:42-46` explicitly call out divergence ("the deliberate divergence from `groupGearItemsByCategory`") around empty-categories handling. Two short tests would lock the contract.

### T-3 — `assignSortOrderSlots` is untested but gates every reorder mutation

Identity, reversed, subset — three tests would catch regression.

### T-4 — `parseDnDId` is untested but is the safety boundary for every drag handler

Five-test set: valid each-kind, empty id, no colon, number id, unknown kind.

### T-5 — Bulk-reorder integration test silently no-ops on empty test account

**`src/lib/queries.bulk-reorder.test.ts:51, 88, 124, 160`** — every test does `if (!row) return // No <table> in the test account.` This is exactly the failure mode CLAUDE.md describes ("a passing test on table A tells you nothing about table B"): if the test account is missing data for one table, that test silently passes as a no-op. Either fail-loud (`expect(row).toBeTruthy()`) and document the seed requirement, or seed the test account programmatically in `beforeAll`.

### T-6 — CSV parse error/edge paths aren't covered

- BOM (Windows-saved CSV starts with U+FEFF).
- Quoted field containing literal `\r\n`.
- CSV with header only, no data rows.
- Cost above the `numeric(10,2)` cap (W-13).

### T-7 — `optimistic.ts` has no unit tests despite being central infrastructure

Mockable end-to-end with a `QueryClient` and a stub `mutationFn`.

### T-8 — `usePortalPopover` is untested

Five sites depend on it. Five tests with `@testing-library/react`: outside-mousedown closes, inside-trigger doesn't, inside-content doesn't, escape (when enabled), scroll (when enabled).

### T-9 — `import-helpers.ts:resolveOrCreateGearForImport` dedup is untested

The match key `(category_id, name.toLowerCase(), weight_grams)` and the "newly-created within this import doesn't match later rows" rule are both subtle.

---

## Top 10 prioritized

1. **B-1** — `WeightTable` drops base weight on unknown category id. Headline number is wrong. Tiny fix; high signal.
2. **B-2** — `editItem` category change corrupts subsequent reorders within the same window. Optimistic UI hides this.
3. **B-3** — `ListDetailPage.deleteGearItemMut` bypasses the optimistic helper that the gear-page version uses.
4. **B-4** — Bulk delete and bulk move skip optimistic helpers AND have no `onError`. A 50-item bulk failure is invisible.
5. **W-5** — `updateGearItem` / `updateListItem` patch types accept `sort_order`, allowing single-row writes that bypass the bulk RPC. Type-system footgun.
6. **W-1** — Three near-identical kebab popovers reimplement positioning + portal. Extract `useAnchoredMenu`.
7. **T-5** — Bulk-reorder integration test silently no-ops on empty test account. Same shape as the historical bulk-reorder gap CLAUDE.md warns about.
8. **W-6 / W-7** — Three `groupBy(category)` implementations and a `CategoryGroup` name shadow.
9. **W-8** — `category!` non-null assertions should be replaced with branch-narrowing.
10. **M-2** — Optimistic apply doesn't bump `updated_at`, so list cards show stale "Updated Xm ago" until refetch.
