# grampacker — performance / efficiency review (2026-05-04)

Scope: whole-codebase, hot paths first.

Caveats:
- App caps are 500 gear items / user, 100 lists / user, 300 list_items / list (DB triggers). Performance risks are mostly bounded — none of the issues below cause user-visible badness today, but several scale poorly within the cap envelope.
- `staleTime: 30s` in `App.tsx:23` is sensible. `refetchOnWindowFocus` is left at the TanStack default (`true`), which is the right call.

Severity scale:
- **High** — observable jank, redundant network, or wasted bytes on the critical path
- **Medium** — measurable cost, scales badly toward the caps, but not blocking
- **Low** — code-cleanliness with a minor measurable improvement

---

## Database

### H1 — Missing indexes on `list_items` (High)

File: `/Users/joe/code/grampacker/supabase/migrations/20260425000002_lists_and_list_items.sql:47-99`. The table is created with NO indexes at all. After 20260506000002 added `user_id`, the table has four indexable columns (`list_id`, `gear_item_id`, `user_id`, `sort_order`) appearing in production query plans:

- `fetchListItems` — `WHERE user_id = ? AND list_id = ? ORDER BY sort_order` (`/Users/joe/code/grampacker/src/lib/queries/list-items.ts:12-21`)
- `fetchAllUserListItems` — joins through `lists` then `WHERE list.user_id = ? ORDER BY sort_order` (`list-items.ts:27-37`)
- `resetPackedForList` — `WHERE list_id = ? AND is_packed = true` (`list-items.ts:100-107`)
- ON DELETE CASCADE from `gear_items.id` and `lists.id` (without an index, those cascades degrade to seq scans)

Cost: at the cap (300 items × 100 lists = 30k rows), the planner falls back to seq scan + sort. Single-tenant today is invisible; multi-tenant, deleting a popular gear_item triggers a 30k-row scan per owner.

Fix: add migration:
```sql
create index list_items_list_sort_idx on public.list_items (list_id, sort_order);
create index list_items_user_id_idx on public.list_items (user_id);
create index list_items_gear_item_id_idx on public.list_items (gear_item_id);
```

### M1 — Missing index on `lists.user_id` (Medium)

`fetchLists` does `WHERE user_id = ? ORDER BY sort_order, name` on every authed page load (`/Users/joe/code/grampacker/src/lib/queries/lists.ts:30-39`); no covering index. Mirrors `categories_user_sort_idx` and `gear_items_user_idx`.
Fix: `create index lists_user_sort_idx on public.lists (user_id, sort_order, name);`

---

## Network / TanStack Query

### H2 — Gear edits broadcast `['list-items']` invalidation across every open list cache (High)

Files: `/Users/joe/code/grampacker/src/gear/GearLibraryPage.tsx:218-232` and `/Users/joe/code/grampacker/src/lists/ListDetailPage.tsx:301-311`. Both wire `invalidateKeys: [['list-items']]` (broad). TanStack matches every `['list-items', listId]` cache the user has visited this session — refetches all of them on every save.

Fix: enumerate the matching list-items caches and invalidate only those whose data contains this gear_item:
```ts
const affectedListIds = qc.getQueryCache().findAll({ queryKey: ['list-items'] })
  .filter(q => (q.state.data as ListItemWithGear[] | undefined)?.some(i => i.gear_item_id === id))
  .map(q => q.queryKey[1] as string)
```
Expected: O(open-lists) refetches → O(lists-using-item).

### H3 — `bulkDeleteGearItems` and `bulkMoveToCategoryGearItems` are non-optimistic (High)

File: `/Users/joe/code/grampacker/src/gear/GearLibraryPage.tsx:246-255`. Both use plain `onSuccess` invalidations rather than the optimistic helpers. User clicks "Delete (12)" and waits for the round-trip plus refetch flash. Every other CRUD on this page is optimistic.

Fix: build `makeOptimisticBulkDelete` / `makeOptimisticBulkMove` helpers (filter by id-set / patch matching rows), drop into the same shape as `makeOptimisticDelete`. Expected: zero perceived latency for bulk ops.

### M2 — `addNewItemMut` issues two sequential round-trips (Medium)

`/Users/joe/code/grampacker/src/lists/ListDetailPage.tsx:327-355` — "+ Add new item" inside a category does `createGearItem` then `addGearItemToList`, serially. Two PostgREST calls.
Fix: collapse into an RPC `add_gear_item_with_list_item(...)`.

### M3 — `duplicateList` and `createListFromSelection` issue 2-3 round-trips (Medium)

- `/Users/joe/code/grampacker/src/lib/queries/lists.ts:119-172` — `duplicateList` is 3 RTT (insert list, fetch source items, insert copies)
- `/Users/joe/code/grampacker/src/lib/queries/lists.ts:97-117` — `createListFromSelection` is 2 RTT
Fix: server-side RPCs.

### M4 — `RootRedirect` blocks at `/` on cold load (Medium)

`/Users/joe/code/grampacker/src/layout/RootRedirect.tsx:18-30` — every authed visit to `/` waits for fetchLists before redirecting. Cold first-paint pays serial: session resolve → fetchLists → redirect → destination page mounts and starts ITS queries.
Fix: prefetch lists eagerly once session is known, or stash last-list-id in localStorage and redirect optimistically.

### L1 — `WeightTable` recomputed on every parent render (Low)

`/Users/joe/code/grampacker/src/lists/WeightTable.tsx:19-50` — full reduce/group runs in render, not memoized. Wrap in `useMemo`.

### L2 — `SharePage.categoryIds` not memoized (Low)

`/Users/joe/code/grampacker/src/lists/SharePage.tsx:29-31` — `categoryIds` recomputed on every render and used in queryKey. Today the join string is stable; cheap fix is `useMemo`.

---

## Database queries / N+1

### Confirmed not present

- `fetchListItems` uses Supabase join, not N+1 (`list-items.ts:12-21`)
- `fetchAllUserListItems` is one round-trip (`list-items.ts:27-37`)
- `bulk_update_sort_order` is single-RTT, atomic
- `select('*')` on canonical reads is appropriate; public reads correctly narrow columns

---

## React render perf

### M6 — Grouping helpers are O(C × I) (Medium)

`/Users/joe/code/grampacker/src/lib/grouping.ts:21-26` and `:51-54`:
```ts
sortedCats.map((cat) => ({
  category: cat,
  items: items.filter((i) => i.gear_item.category_id === cat.id),  // O(I) per category
}))
```
At cap: 30 categories × 300 items = 9000 comparisons per memo run. Reorder mutations replace the items array on every drag tick.

Fix: single-pass bucket map. Same fix in `LibraryPanel.tsx:55-58`. Expected: 10-100× speedup at cap.

### M7 — `LibraryPanel` recomputes filter+group on every parent state change (Medium)

`/Users/joe/code/grampacker/src/lists/LibraryPanel.tsx:45-60` — `filtered`, `sortedCats`, `groups`, `uncategorized` all recompute on every render. Parent `ListDetailInner` rerenders on every drag tick, dialog change, NotesEditor keystroke. Wrap in `useMemo`.

### M8 — `ListDetailPage.sharedGroupProps` busts memo on every list-items mutation (Medium)

`/Users/joe/code/grampacker/src/lists/ListDetailPage.tsx:471-498` — the memo deps include `gearItems` and `listItems` because the closures call `.find` against them. Every list_items mutation invalidates the memo → every CategoryGroup gets a new prop reference and re-renders all its rows.

Fix: store the lookups behind refs:
```ts
const gearItemsRef = useRef(gearItems); gearItemsRef.current = gearItems
const listItemsRef = useRef(listItems); listItemsRef.current = listItems
// ...inside closures, read .current
```
Drop both arrays from deps. Expected: zero re-renders of all CategoryGroups + dnd-kit's `useSortable` per row on every checkbox tick.

### M9 — `formatRelativeDate` ticks computed at render and locked (Medium-Low)

`/Users/joe/code/grampacker/src/lists/ListsPage.tsx:678-713` — "1 min ago" never updates. Either drop to absolute date or run a setInterval to retick.

### M10 — `usePortalPopover` schedules a passive effect on every render of every row (Medium)

`/Users/joe/code/grampacker/src/lib/use-portal-popover.ts:49-51`:
```ts
useEffect(() => { onCloseRef.current = onClose })   // no deps — runs every render
```
With ~300 list items + 500 gear items, that's 800 scheduled passive-effect tasks per render. During reorder drags, every row re-renders continuously.
Fix: add `[onClose]` deps.

### M11 — `ItemRow` / `GearItemRow` mount BOTH desktop and mobile branches (Medium)

- `/Users/joe/code/grampacker/src/lists/ItemRow.tsx:204-336`
- `/Users/joe/code/grampacker/src/gear/GearItemRow.tsx:66-117`

Both `<div className="hidden lg:contents">` AND `<div className="lg:hidden">` mount unconditionally; CSS hides one. Mobile users render both `InlineText` (name+description), all RowIconButtons, WeightInput, AND MobileRowBody. Doubles instance count on mobile for no visual reason.

Fix: gate on viewport hook (mirror `/Users/joe/code/grampacker/src/layout/ListSelector.tsx:29-40`'s `useIsMobile`).

### M12 — `LibraryPanel.CategoryGroup` re-renders all categories on parent state churn (Medium)

`/Users/joe/code/grampacker/src/lists/LibraryPanel.tsx:121-209` — inner `CategoryGroup` not memoized.
Fix: `React.memo(CategoryGroup)`. The parent already memoizes `listItemGearIds` (`ListDetailPage.tsx:431-434`).

### L3-L4 — Drag handlers / collision-detection memo (Low)

`/Users/joe/code/grampacker/src/gear/GearLibraryPage.tsx:288-302` and `:340-396`, `/Users/joe/code/grampacker/src/lists/ListDetailPage.tsx:381-408`. Cold path; runs once per drop; bounded.

---

## Optimistic update audit

### Confirmed correct

- All `make*Optimistic*` helpers roll back via `setQueryData(queryKey, ctx.previous)` (`optimistic.ts:130-138`)
- `makeOptimisticReorder` clones items rather than mutating (`optimistic.ts:240-245`)
- `makeOptimisticUpdate.apply()` returns new objects

---

## Bundle / code-splitting

### H4 — `react-markdown` + `remark-gfm` shipped in main bundle (High)

`/Users/joe/code/grampacker/src/components/MarkdownPage.tsx:1-2` imports eagerly. Pulls in `mdast-util-*`, `unified`, `vfile`, GFM grammar — ~60-80 KB gzipped, used only on `/help` and `/about` (both static markdown).
Fix: `React.lazy(() => import('./MarkdownPage'))` or lazy-load the whole AboutPage/HelpPage routes.

### H5 — `vaul` (drawer) shipped to every route (High)

`/Users/joe/code/grampacker/src/lists/ListDetailPage.tsx:20` and `/Users/joe/code/grampacker/src/layout/ListSelector.tsx:5`. ListSelector mounts on every authed page (it's in NavBar). Drawer is ~15-20 KB gzipped, mobile-only.
Fix: dynamic-import or split into a `MobileDrawer` lazy component.

### H6 — `fflate` shipped for SettingsPage zip export (High)

`/Users/joe/code/grampacker/src/settings/SettingsPage.tsx:4` — only used inside the "Download all data" handler, ~20 KB gzipped.
Fix: dynamic import inside `handleDownload`:
```ts
const { zipSync, strToU8 } = await import('fflate')
```

### M13 — Verify `lucide-react` tree-shaking (Medium)

24 files import named icons. lucide-react v1.14 occasionally fails to tree-shake cleanly. Verify by inspecting `dist/assets/index-*.js` size; if it's bloated, switch to per-icon paths.

### L7 — Routes not code-split (Low)

`/Users/joe/code/grampacker/src/routes.tsx` and `/Users/joe/code/grampacker/src/layout/AppShell.tsx` import all pages eagerly.
Fix: lazy-load auth pages and SharePage.

---

## Misc

### L9 — `formatPurchaseDate` constructs `Intl` formatter per call (Low)

`/Users/joe/code/grampacker/src/gear/GearItemRow.tsx:137-142` — `d.toLocaleDateString(undefined, {...})` constructs an Intl formatter each call. Hoist a single `DATE_FORMATTER` constant like the existing `COST_FORMATTER` (`:124`).

---

## Top 10 prioritized fixes

1. **H4 — Lazy-load `react-markdown` + `remark-gfm`** (~60-80 KB off initial bundle).
2. **H5 — Lazy-load `vaul` drawer** (~15-20 KB off desktop bundle).
3. **H6 — Dynamic-import `fflate`** in SettingsPage download handler (~20 KB off).
4. **H1 — Add indexes on `list_items` (list_id+sort_order, user_id, gear_item_id)**.
5. **M11 — Conditional render of mobile vs desktop branch in ItemRow / GearItemRow**.
6. **M6 — Single-pass bucket map in `groupListItemsByCategory` / `groupGearItemsByCategory`**.
7. **M8 — Drop `gearItems`/`listItems` from `sharedGroupProps` deps via refs**.
8. **H2 — Narrow `editItem` cache invalidation to lists actually containing the gear item**.
9. **H3 — Make `bulkDelete` / `bulkMove` optimistic**.
10. **M7 — Memoize `filtered` / `sortedCats` / `groups` in `LibraryPanel`**.

Honorable mention: **M10** — single-line fix to `usePortalPopover.ts:49-51` (add `[onClose]` deps) removes 300+ scheduled passive effects per render during drag.

---

## Confirmed strengths (no action needed)

- Bulk reorder uses SECURITY DEFINER RPC; single round-trip, atomic
- `staleTime: 30s` is well-chosen
- Optimistic helpers correctly snapshot, write immutably, and roll back via reference replacement
- `assignSortOrderSlots` keeps reorders to a permutation of existing slots
- PWA service worker correctly caches REST GETs with `StaleWhileRevalidate` and bypasses mutations and auth
- Cache invalidation rules are documented and followed
- Public read paths use narrow column lists
- Composite FKs prevent cross-owner reference attacks (migration 20260506000002)
- DB row caps (500/100/300) bound the worst case
