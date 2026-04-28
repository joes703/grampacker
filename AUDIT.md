# Code Quality Audit: grampacker

**Date:** 2026-04-27  
**Scope:** src/ directory; focus on recent iteration changes (commits b9b3092 → ee47ec6)

---

## Summary

This codebase accumulated **3 high-severity issues, 6 medium-severity issues, and 3 low-severity issues** during today's heavy iteration. Most are tractable cleanup tasks (dead code, duplication, performance waste) that pose minimal refactoring risk. The drag-drop refactoring from nested DndContexts to single DndContext per page is solid; no regressions detected.

---

## High Severity Issues

### 1. Missing Optimistic Rollback Path in `reorderGearItemsMut`
**Location:** `src/gear/GearLibraryPage.tsx:212–217`  
**Severity:** HIGH  
**Risk:** Small  

**Description:**  
`reorderGearItemsMut` uses `makeOptimisticReorder<GearItem>(qc, queryKeys.gearItems())` which spreads in `onMutate` and `onError` handlers. However, the mutation's `mutationFn` uses `Promise.all(updates.map(...))` to update multiple items sequentially via individual API calls. If any call fails mid-sequence, the mutation fails but only the succeeding items were persisted. The optimistic rollback restores the pre-mutation state, but this mismatch can leave the backend inconsistent.

**Suggested Fix:**  
Either (a) batch all sort-order updates in a single database call, or (b) add explicit onSettled invalidation after reorderGearItemsMut to force a fresh fetch. Currently, GearLibraryPage relies on the generic makeOptimisticReorder pattern without explicit invalidation on settle.

**Real-world Impact:** After a network error during a multi-item same-category reorder on the gear library page, the UI rolls back correctly but the backend may have persisted some but not all updates. Refreshing the page reveals the inconsistency.

---

### 2. Inline Object Creation in `sharedGroupProps` Rebuilds Every Render
**Location:** `src/lists/ListDetailPage.tsx:686–707`  
**Severity:** HIGH  
**Risk:** Small  

**Description:**  
Inside the IIFE that renders category groups (line 682–770), `sharedGroupProps` is an object literal rebuilt every render. This object is spread into every SortableCategoryGroup and CategoryGroup, which will re-render even if their other props didn't change. The `onEditGearItem` and `onDeleteGearItem` closures capture `gearItems` from the parent scope, forcing the object to rebuild on every gearItems query update.

**Suggested Fix:**  
Wrap `sharedGroupProps` in `useMemo` with dependency array `[mode, weightUnit, updateMut, deleteMut, updateGearItemMut, gearItems]`. This prevents unnecessary category-group re-renders when unrelated state (e.g., mode) changes.

**Performance Impact:** On gearItems updates (e.g., weight edit), every category group re-renders, triggering ItemRow re-renders even though the active list's items haven't changed.

---

### 3. Duplicate Category Namespace Helpers With Identical Implementations
**Location:** `src/lists/CategoryGroup.tsx:16–25` and `src/gear/CategorySection.tsx:16–25`  
**Severity:** HIGH  
**Risk:** Small  

**Description:**  
`CATEGORY_DROP_PREFIX` / `categoryDroppableId()` / `parseCategoryDroppableId()` in CategoryGroup.tsx and `GEAR_CATEGORY_DROP_PREFIX` / `gearCategoryDroppableId()` / `parseGearCategoryDroppableId()` in CategorySection.tsx are identical in logic but separate implementations. Both also export `UNCATEGORISED_KEY` / `GEAR_UNCATEGORISED_KEY` (functionally the same string). This duplication means any future fix to the namespace logic must be applied in two places.

**Suggested Fix:**  
Extract shared helpers to `src/lib/dnd-namespaces.ts`:
```typescript
export const CATEGORY_DROP_PREFIX = 'category-drop:'
export const UNCATEGORISED_KEY = '__uncategorised__'
export function categoryDroppableId(categoryId: string | null): string { ... }
export function parseCategoryDroppableId(id: string): string | null | undefined { ... }
// And a variant pair for gear:
export const GEAR_CATEGORY_DROP_PREFIX = 'gear-category-drop:'
export function gearCategoryDroppableId(categoryId: string | null): string { ... }
export function parseGearCategoryDroppableId(id: string): string | null | undefined { ... }
```
Keep the exports in both files for local convenience, but source them from the shared module.

**Maintenance Impact:** Any namespace collision bug or parsing edge case discovered will require fixes in two places.

---

## Medium Severity Issues

### 4. Missing Cancellation in Cross-Category Mutations Before `onMutate`
**Location:** `src/lists/ListDetailPage.tsx:340–342` and `src/gear/GearLibraryPage.tsx:244–245`  
**Severity:** MEDIUM  
**Risk:** Small  

**Description:**  
Both `moveAcrossCategoriesMut` in ListDetailPage and `moveGearAcrossCategoriesMut` in GearLibraryPage call `qc.cancelQueries()` at the start of `onMutate`. However, there is a race window: between the user's drag-end and the `onMutate` callback firing, if a background refetch of the same queryKey starts, the `cancelQueries` call may not catch it. The optimistic update then competes with the real fetch arriving simultaneously, leading to potential cache thrashing.

**Suggested Fix:**  
This is low-probability in practice but defensible: call `cancelQueries` in the `mutationFn` before hitting the API, not just in `onMutate`. React Query's default behavior cancels in-flight queries on mutation, but explicit cancellation is clearer.

**Risk:** Minimal refactoring; the current code is defensive enough for most cases.

---

### 5. Redundant Broad Cache Invalidation in Cross-Category Mutations
**Location:** `src/lists/ListDetailPage.tsx:370–372` and `src/gear/GearLibraryPage.tsx:262–264`  
**Severity:** MEDIUM  
**Risk:** Small  

**Description:**  
On `onSettled` (success or error), both mutations invalidate `['list-items']` (broad key matching all lists) even though only the current list's items may have changed. This forces refetches of every list's items, not just the active list.

In ListDetailPage:
```typescript
onSettled: () => {
  qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
  qc.invalidateQueries({ queryKey: ['list-items'] })  // ← too broad
  qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
}
```

The broad `['list-items']` is justified for the gear-item level (one gear item may appear in many lists), but then specific `queryKeys.listItems(listId)` is redundant.

**Suggested Fix:**  
Narrow `['list-items']` invalidation only when truly necessary. In ListDetailPage's `moveAcrossCategoriesMut`, drop the broad invalidation; rely on the specific `listId` cache invalidation. In GearLibraryPage, the broad invalidation is justified (one gear item moved affects multiple lists), so keep it.

**Query Waste:** Each invalidation triggers a stale-while-revalidate refetch. The broad key batches multiple lists' refreshes, but still unnecessary for single-list moves.

---

### 6. `categories.some()` Called Twice per Drag in Same Branch
**Location:** `src/lists/ListDetailPage.tsx:397, 407` and `src/gear/GearLibraryPage.tsx:289, 298`  
**Severity:** MEDIUM  
**Risk:** Small  

**Description:**  
In the category-drag branch of `handleDragEnd`, the code checks `if (categories.some((c) => c.id === activeIdStr))` to detect a category drag (line 397). Inside that branch, it later checks `if (sortedCats.some((c) => c.id === overIdStr))` to see if the drop target is also a category (line 407). Both are O(n) scans. With many categories, this is wasteful.

**Suggested Fix:**  
Cache a Set of category IDs once at the start of handleDragEnd:
```typescript
const categoryIds = new Set(categories.map(c => c.id))
// Later:
if (categoryIds.has(activeIdStr)) { ... }
if (categoryIds.has(overIdStr)) { ... }
```

**Performance Impact:** Negligible for typical apps with <50 categories; linear in category count otherwise.

---

### 7. `destItems` is Not Sorted Before `assignSortOrderSlots` in ListDetailPage Cross-Category Drop
**Location:** `src/lists/ListDetailPage.tsx:463–479`  
**Severity:** MEDIUM  
**Risk:** Medium  

**Description:**  
In ListDetailPage's cross-category move logic, `destItems` is filtered but NOT explicitly sorted:
```typescript
const destItems = listItems.filter(
  (i) => (i.gear_item?.category_id ?? null) === destCat && i.id !== activeItem.id,
)
```

Then it's spread into `newDestOrder` and passed to `assignSortOrderSlots`. Comparison: GearLibraryPage explicitly sorts its destItems before using them (line 352: `.sort((a, b) => a.sort_order - b.sort_order)`).

If `listItems` aren't pre-sorted by `sort_order` (they should be from the fetch, but assumptions decay), the reordering will compute slots from an unsorted source, potentially misaligning the moved item.

**Suggested Fix:**  
Explicitly sort `destItems` before constructing `newDestOrder`:
```typescript
const destItems = listItems
  .filter((i) => (i.gear_item?.category_id ?? null) === destCat && i.id !== activeItem.id)
  .sort((a, b) => a.sort_order - b.sort_order)
```

**Risk:** Medium because the impact depends on whether upstream data is reliably sorted; a safer defensive sort is warranted.

---

### 8. Mutation Handler Names Inconsistent Across Pages
**Location:** `src/lists/ListDetailPage.tsx` and `src/gear/GearLibraryPage.tsx` (various)  
**Severity:** MEDIUM  
**Risk:** Small  

**Description:**  
Naming conventions differ between pages:
- ListDetailPage uses `activeId` (can be an item or category); GearLibraryPage also uses `activeId` (same role).
- ListDetailPage uses `gearItemId`, `newCategoryId`, `sortUpdates` in cross-category mutation; GearLibraryPage uses `movedItemId`, `newCategoryId`, `sortUpdates` in its equivalent mutation.
- ListDetailPage's local state uses `editingGearItem` and `deleteGearCandidate` (action-specific names); GearLibraryPage uses `setDialog` with a discriminated union type.

This inconsistency makes cross-file refactoring harder (e.g., extracting a shared cross-category handler).

**Suggested Fix:**  
Standardize parameter names for the equivalent mutations. Use `movedItemId` in both, or `itemId` as a more generic term. Align on a single pattern for dialog/editing state (preference: discriminated union like GearLibraryPage's approach; it's more flexible).

**Risk:** Small; documentation + careful PR review suffices.

---

### 9. Stale Comment in CategoryGroup About Drag-Context Structure
**Location:** `src/lists/CategoryGroup.tsx:23–40`  
**Severity:** MEDIUM  
**Risk:** Low  

**Description:**  
The comment block explaining editing affordances and gating mentions:
> "- sortable ⇒ rows render as SortableItemRow. Must be inside a page-level <SortableContext> covering all items."

This is still accurate, but the comment's layered DndContext explanation (circa the nested-DndContext refactor, commit a36760e) doesn't mention the current structure: one DndContext per page with outer SortableContext for categories and inner SortableContext for items. The comment survived the refactor but describes an older mental model.

**Suggested Fix:**  
Update the comment to clarify the current single-DndContext, dual-SortableContext structure.

**Risk:** Low; clarification only.

---

## Low Severity Issues

### 10. Modal Centering Fix (m-auto) Not Documented
**Location:** `src/components/Modal.tsx:65`  
**Severity:** LOW  
**Risk:** Low  

**Description:**  
Commit f600509 added `m-auto` to the dialog className to center modals after a Tailwind preflight reset broke the default centering. The className string has no comment explaining why `m-auto` is needed (it's not obvious from the class alone that this is a regression fix, not a styling choice).

**Suggested Fix:**  
Add a comment explaining the fix:
```typescript
className={`m-auto rounded-xl bg-white p-0 shadow-lg backdrop:bg-black/40 ${className ?? ''}`}
// or:
// m-auto centers the dialog (Tailwind preflight reset broke native centering)
```

**Risk:** Minimal; documentation only.

---

### 11. Unused Export: `categoryDroppableId` and `gearCategoryDroppableId`
**Location:** `src/lists/CategoryGroup.tsx:18–19` and `src/gear/CategorySection.tsx:18–19`  
**Severity:** LOW  
**Risk:** Small  

**Description:**  
The `categoryDroppableId(categoryId)` and `gearCategoryDroppableId(categoryId)` functions are exported but never called outside their defining modules. The id-generation logic is embedded in the component's `useDroppable` hook directly. These exports are likely convenience functions from an earlier design; they're exported but not used.

**Suggested Fix:**  
Mark as private (remove `export`), or delete if truly dead. If they might be used by future features, add a comment explaining their purpose.

**Risk:** Small; purely mechanical cleanup.

---

### 12. Inconsistent Error Handling in `addNewItemMut` Cache Invalidation
**Location:** `src/lists/ListDetailPage.tsx:268–285`  
**Severity:** LOW  
**Risk:** Low  

**Description:**  
`addNewItemMut` creates both a gear item and a list item as a side effect:
```typescript
const addNewItemMut = useMutation({
  mutationFn: async ({ categoryId, data }: { categoryId: string | null; data: AddItemData }) => {
    const newGear = await createGearItem(...)
    await addGearItemToList(...)
  },
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
    qc.invalidateQueries({ queryKey: queryKeys.listItems(listId) })
  },
})
```

If `createGearItem` succeeds but `addGearItemToList` fails, the mutation fails and neither cache is invalidated. The new gear item exists in the database but isn't added to the list, and the UI doesn't know. No `onError` handler to detect this partial success.

**Suggested Fix:**  
Add an `onError` handler to log or notify the user:
```typescript
onError: (err) => {
  console.error('Failed to add item to list. A gear item may have been created but not added to the list.', err)
  // Optionally invalidate anyway to discover the orphaned gear item on next fetch
  qc.invalidateQueries({ queryKey: queryKeys.gearItems() })
},
```

Alternatively, wrap the mutation in a transaction at the API level (e.g., a stored procedure).

**Risk:** Low; the issue is rare (requires network failure between two successive calls), but good hygiene to handle.

---

## Summary: Highest-Impact vs. Lowest-Risk Fixes

| # | Issue | Fix | Time | Risk | Impact |
|---|-------|-----|------|------|--------|
| 3 | Duplicate namespace helpers | Extract to shared module + re-export | 30 min | Small | High (maintainability) |
| 1 | Missing settle invalidation in reorderGearItemsMut | Add explicit `onSettled` + invalidation or batch API | 20 min | Small | High (correctness) |
| 2 | Inline sharedGroupProps in render | Wrap in useMemo | 10 min | Small | Medium (perf) |
| 7 | destItems not sorted in ListDetailPage | Add `.sort()` before use | 5 min | Small | Medium (correctness) |
| 6 | categories.some() twice in drag handler | Cache categoryIds Set | 15 min | Small | Low (perf) |
| 5 | Broad ['list-items'] invalidation | Narrow to specific listId | 10 min | Small | Low (query waste) |
| 10 | Modal m-auto not documented | Add comment | 2 min | Low | Low (clarity) |
| 11 | Unused exports | Remove or document | 5 min | Small | Low (cleanup) |
| 12 | addNewItemMut partial-failure handling | Add onError handler | 10 min | Small | Low (rare case) |

**Top 5 Quick Wins** (do these first):
1. Wrap `sharedGroupProps` in useMemo (10 min, prevents re-renders)
2. Sort `destItems` explicitly in ListDetailPage (5 min, correctness)
3. Cache categoryIds Set in drag handlers (15 min, avoids O(n) lookups)
4. Extract namespace helpers (30 min, eliminates duplication)
5. Add `onSettled` to reorderGearItemsMut (20 min, ensures cache consistency)

---

**No Architectural Rewrites Needed.** All issues are localized cleanup, optimization, or documentation tasks. The drag-drop refactoring (nested → single DndContext) is solid.
