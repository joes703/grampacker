# grampacker code audit

Walked the codebase against [STANDARDS.md](STANDARDS.md). Findings grouped by
severity. Within each severity, sorted by risk of fixing (small first).
Stylistic nits omitted unless they actively cause confusion. No architectural
overhauls proposed; this is cleanup, not redesign.

Project shape at audit time: 5,287 LOC across 30 TS/TSX files. The two
orchestration roots (`ListDetailPage.tsx` 1,307 LOC, `GearLibraryPage.tsx`
818 LOC) account for ~40% of source.

---

## High severity

> Likely bugs or measurable issues.

### H1 · Mutations swallow errors silently
- **Location**: `src/lists/ListDetailPage.tsx` (every `useMutation` call —
  ~12 of them: `addMut`, `updateMut`, `deleteMut`, `reorderCatsMut`,
  `reorderListsMut`, `reorderItemsMut`, `notesMut`, `updateGearItemMut`,
  `deleteGearItemMut`, `addNewItemMut`, `renameMut`, `deleteListMut`,
  `createListMut`, `duplicateMut`, `importMut`, `setPrivacyMut`).
  Same in `src/gear/GearLibraryPage.tsx` (`addCategory`, `renameCategory`,
  `removeCategory`, `reorderCats`, `addItem`, `editItem`, `removeItem`,
  `bulkDelete`, `bulkMove`, `importItems`, `createListFromSelectionMut`).
- **Standard violated**: §7 Error handling — "every `useMutation` should have
  a story for failure". §11 anti-pattern #16 (silent failures).
- **Severity**: high.
- **Description**: Almost every mutation in the app has no `onError`. When a
  Supabase call fails (RLS, validation, network), nothing surfaces to the user
  and nothing is logged. The diagnostic `alert` we briefly added during the
  list-items migration debugging has been removed; we now silently fail again.
  Concretely this means: a flaky migration, a retroactive RLS change, or a
  network blip looks like "the click didn't do anything."
- **Suggested fix**: Introduce a single `useMutation` wrapper or a default
  `onError` via `QueryClient`'s `mutationCache.config.onError` that
  `console.error`s and renders a minimal toast. Until a toast exists, an
  inline error banner per page is acceptable. Either way, no more silent
  failures.
- **Risk of fixing**: medium. One-line per mutation if we settle for
  console.error; larger if we add a toast system. Recommend the smaller fix
  first.

### H2 · Library panel rows are non-keyboard-accessible clickable divs
- **Location**: `src/lists/LibraryPanel.tsx` ~lines 160-198 (the `<div onClick>`
  per row).
- **Standard violated**: §8 Accessibility — "Every interactive element is a
  `<button>` or `<a>`, never a clickable `<div>`."
- **Severity**: high.
- **Description**: The row is the click target for add / remove from list, but
  it's a `<div>`. Keyboard users can't tab to it, can't activate it with
  Enter, screen readers don't announce it as actionable. The trash button on
  the row is a real `<button>` and reachable, but the primary action isn't.
- **Suggested fix**: Change the row to `<button type="button">`, keep the
  inner `<p>` and `<span>` for layout. Make sure the trash overlay button's
  `e.stopPropagation()` still works. The hover overlay's
  `pointer-events-none` already lets clicks pass through correctly.
- **Risk of fixing**: small. Nested buttons aren't valid HTML, so the trash
  button needs to live as a sibling absolute element rather than a child of
  the row button — already structurally close to that today.

### H3 · `g as GearItem` cast on a partial select in `importCsvRowsToList`
- **Location**: `src/lib/queries.ts` ~lines 348-356.
- **Standard violated**: §2 TypeScript — "`any` is never acceptable", and the
  spirit of unsafe casts (`g as GearItem`) when the runtime shape is partial.
- **Severity**: high (latent bug).
- **Description**: The freshly-inserted gear items are selected with
  `.select('id, name')`, then cast to `GearItem` and shoved into the
  `gearByName` map. Downstream code uses `gear.id` only, which happens to be
  present, so it works today. Any future code that reads `weight_grams` or
  `category_id` off these entries would get `undefined` typed as `number`.
- **Suggested fix**: Either select all columns we'll need, or store only the
  id (`Map<string, string>`) and look up the rest from elsewhere. The first
  is simpler.
- **Risk of fixing**: small.

### H4 · Drag-and-drop optimistic updates skip cancel/rollback/settle
- **Location**: `src/lists/ListDetailPage.tsx` (category drag end ~line 250
  area, list-item drag end inside `ListCategoryGroup` callsites ~lines 540
  and 605, lists drag end ~line 530 area). `src/gear/GearLibraryPage.tsx`
  (`reorderCats` drag end).
- **Standard violated**: §3 State management — canonical optimistic-update
  pattern (cancel → snapshot → mutate → rollback on error → settle).
- **Severity**: high (latent bug; appears as glitches on slow / flaky network).
- **Description**: We `qc.setQueryData(...)` and then `mutate(...)` without
  cancelling in-flight refetches, snapshotting the old data, or rolling back
  on error. If a refetch lands between the optimistic write and the mutation
  succeeding, the optimistic state is overwritten with stale order. If the
  mutation fails, the UI keeps the bad order indefinitely.
- **Suggested fix**: Implement the canonical pattern in one place
  (e.g., a `useOptimisticReorder` helper) and use it from each drag-end
  handler. Standard requires `cancelQueries`, snapshot before, rollback in
  `onError`, invalidate in `onSettled`.
- **Risk of fixing**: medium. The pattern is a small refactor per callsite;
  testing requires throttling network or adding artificial delay.

### H5 · Modal dialogs lack focus trap, focus restore, and ARIA labelling
- **Location**: every dialog (`ConfirmDialog`, `TypedConfirmDialog`,
  `ImportPreviewDialog`, `BulkMoveCategoryDialog`,
  `CreateListFromSelectionDialog`, the inline import-error dialog,
  `GearItemDialog`, `PrivacyButton`'s popover).
- **Standard violated**: §8 Accessibility — focus management, ARIA.
- **Severity**: high (accessibility regression; would block screen-reader use).
- **Description**: Our overlays are custom `<div className="fixed inset-0
  bg-black/40">` boxes with no `role="dialog"`, no `aria-modal="true"`, no
  `aria-labelledby`, no focus trap, no focus restore on close. Tab can escape
  the modal. Screen readers don't announce the dialog title.
- **Suggested fix**: Pick one of (a) migrate to the native `<dialog>` element
  per the standard's preference, or (b) extract a small `Modal` wrapper that
  renders into a portal, applies the ARIA, adds a focus trap, and restores
  focus to the trigger on close. Option (a) is the lower-maintenance choice.
- **Risk of fixing**: medium. Behavior largely the same, but every dialog
  needs to migrate. Fits the criteria for a single batched cleanup.

### H6 · `AddItemRow` loses input on click-away
- **Location**: `src/lists/ListDetailPage.tsx` lines ~1076-1170 (the
  `AddItemRow` component).
- **Standard violated**: §1 forms — consistency with `InlineText` and the
  rest of the list (Enter saves, blur saves).
- **Severity**: high (data-loss UX; surprising).
- **Description**: The other inline editors (name, description, weight, qty,
  ListsBox rename, gear-library inline rename) commit on blur. `AddItemRow`'s
  inputs commit only on Enter. If the user types a name + weight and then
  clicks elsewhere on the page (e.g. another item to learn what category it
  was in), the draft row stays open with their typed data, but if they
  re-engage with another inline editor, blur on AddItemRow's inputs loses
  the entered text without any save attempt.
- **Suggested fix**: Track focus across the whole AddItemRow container
  (focusin/focusout on the row), commit on blur out of the row only; Escape
  still cancels. Or simpler: commit-on-Enter is fine but make the X button
  more visually obvious as the cancel.
- **Risk of fixing**: small.

---

## Medium severity

> Quality issues worth fixing.

### M1 · Dead exports in `lib/weight.ts`
- **Location**: `src/lib/weight.ts` lines 21-28 (`formatTotalWeight`),
  37-59 (`WeightRollup` type, `computeWeightRollup` function).
- **Standard violated**: §11 anti-pattern #1 (dead code).
- **Severity**: medium.
- **Description**: `formatTotalWeight`, `WeightRollup`, and
  `computeWeightRollup` are exported but referenced nowhere. Confirmed via
  grep across `src/`. They were leftovers from an earlier `SharePage` design
  that has since been replaced.
- **Suggested fix**: Delete them.
- **Risk of fixing**: small. Build verifies.

### M2 · `formatGrams` duplicates `formatItemWeight(g, 'g')`
- **Location**: `src/lib/weight.ts` lines 10-18 (the two functions).
- **Standard violated**: §1 / general DRY (duplication memory).
- **Severity**: medium.
- **Description**: `formatItemWeight(grams, 'g')` returns `${grams} g`.
  `formatGrams(grams)` returns `${grams} g`. Same output. The intent
  ("convenience: always-grams formatter") doesn't justify a second function;
  a call site that wants grams unconditionally can pass `'g'`.
- **Suggested fix**: Delete `formatGrams`. Update the two consumers
  (`GearLibraryPage` import-preview row, `ListDetailPage` import-preview row)
  to call `formatItemWeight(weight, 'g')`.
- **Risk of fixing**: small.

### M3 · `LAST_LIST_KEY` magic string lives inside `ListDetailPage`
- **Location**: `src/lists/ListDetailPage.tsx` line 75 — `const LAST_LIST_KEY
  = 'grampacker:lastListId'`.
- **Standard violated**: §6 file org — cross-cutting constants belong in
  `lib/`.
- **Severity**: medium.
- **Description**: Other `localStorage` keys live in `lib/weight.ts`
  (`weightUnit`). The last-viewed-list key is the same kind of preference but
  hardcoded inside the page.
- **Suggested fix**: Move the constant + the read/write helpers to a small
  `lib/preferences.ts` (or extend `lib/weight.ts`'s pattern). Same shape as
  `getWeightUnit`/`setWeightUnit`.
- **Risk of fixing**: small.

### M4 · `gearByName` map mixes full and partial GearItem shapes
- **Location**: `src/lib/queries.ts` ~line 331 (initial seed with
  `existingGearItems`) vs ~line 354 (re-seed with `select('id, name')`).
- **Standard violated**: §2 TypeScript — type accuracy.
- **Severity**: medium (related to H3 but the typing of the map itself is
  also wrong).
- **Description**: `gearByName: Map<string, GearItem>` is initialized with
  full `GearItem`s, then later mutated to hold `{id, name}` cast as
  `GearItem`. Any code that later reads other fields off map entries will
  silently get `undefined`.
- **Suggested fix**: Narrow the map to `Map<string, { id: string; name:
  string }>` since downstream only reads `gear.id`.
- **Risk of fixing**: small. Same change as H3, just typed honestly.

### M5 · `setActivatorNodeRef` unsafe cast repeated in 3 files
- **Location**: `src/lists/ListsBox.tsx`, `src/lists/ListItemRow.tsx`,
  `src/gear/CategorySection.tsx` — each has
  `setActivatorNodeRef as unknown as (node: HTMLButtonElement | null) => void`.
- **Standard violated**: §1 / DRY.
- **Severity**: medium (also flagged in standards as one of the rare
  acceptable casts).
- **Suggested fix**: Extract a one-line helper (e.g.
  `asButtonRef(setActivatorNodeRef)`) in `lib/dnd.ts` so the cast lives in one
  place with the comment explaining why.
- **Risk of fixing**: small.

### M6 · `Parameters<typeof updateListItem>[1]` type indirection
- **Location**: `src/lists/ListDetailPage.tsx` line ~193 and the
  `GroupProps.onUpdate` definition.
- **Standard violated**: §2 TypeScript — types should be self-explanatory.
- **Severity**: medium.
- **Description**: This `Parameters<typeof X>[1]` trick couples the prop
  type to the function's argument list order. Reordering or extending
  `updateListItem` silently widens or breaks the prop type. The patch type
  is small enough to name directly (`Pick<ListItem, 'quantity' | 'is_worn' |
  'is_consumable' | 'is_packed' | 'sort_order'>` partial-ed).
- **Suggested fix**: Define and export `type ListItemPatch = Partial<Pick<...>>`
  in `lib/queries.ts`, use it both in `updateListItem`'s signature and as the
  prop type.
- **Risk of fixing**: small.

### M7 · Inline-edit "save on blur" inconsistency
- **Location**: `src/components/InlineText.tsx` (saves on blur),
  `src/lists/ListDetailPage.tsx` (`AddItemRow` does not), `src/lists/ListsBox.tsx`
  (rename row saves on blur), name/desc cells via `InlineText` save on blur.
- **Standard violated**: §1 forms — consistency.
- **Severity**: medium.
- **Description**: Most inline edits in the app save on blur; `AddItemRow`
  doesn't. Users have to learn one rule on most rows and a different rule for
  the new-item row. Drives H6.
- **Suggested fix**: Same as H6.
- **Risk of fixing**: small.

### M8 · `handleImportFile` duplicated between `ListDetailPage` and `GearLibraryPage`
- **Location**: `src/lists/ListDetailPage.tsx` ~line 280, `src/gear/GearLibraryPage.tsx`
  ~line 110.
- **Standard violated**: §1 / DRY.
- **Severity**: medium.
- **Description**: Both implement the same "click hidden input → read file →
  parse → set preview-or-error state" flow. The parser differs (`parseGearCsv`
  vs `parseListCsv`), but the file-handling boilerplate is identical.
- **Suggested fix**: Extract `useCsvFileInput<T>(parser, onPreview, onError)`
  hook in `lib/` returning `{ inputRef, onChange }`.
- **Risk of fixing**: small.

### M9 · Inline reorder slot-shuffle logic duplicated in `ListDetailPage`
- **Location**: `src/lists/ListDetailPage.tsx` ~lines 540 (sortable) and ~605
  (uncategorised).
- **Standard violated**: §1 / DRY.
- **Severity**: medium.
- **Description**: The `onReorderItems` closure is copy-pasted: build slots,
  zip with new order, optimistically update, mutate. Change one and the other
  drifts.
- **Suggested fix**: Hoist into a single `handleItemsReorder` function defined
  once on the parent.
- **Risk of fixing**: small.

### M10 · `onSaveGear*` + `onAddItem` prop sets duplicated at category callsites
- **Location**: `src/lists/ListDetailPage.tsx` ~lines 537-560 (sortable) and
  ~590-625 (uncategorised).
- **Standard violated**: §1 / DRY.
- **Severity**: medium.
- **Description**: Same five inline arrow-prop bindings (`onSaveGearName`,
  `onSaveGearDescription`, `onSaveGearWeight`, `onAddItem`,
  `onReorderItems`) wired identically in both branches.
- **Suggested fix**: Build a single `groupCommonProps` object once per
  render and spread it.
- **Risk of fixing**: small.

### M11 · Direct `supabase.from(...)` calls bypassing `lib/queries.ts`
- **Location**: `src/gear/GearLibraryPage.tsx` `importItems` mutation
  ~lines 220-260 (`.from('gear_items').insert(items)`).
- **Standard violated**: §4 Supabase patterns — query layer should live in
  `lib/queries.ts` for type-safe, consistent error handling.
- **Severity**: medium.
- **Description**: Most data access goes through `lib/queries.ts` helpers,
  but the gear-CSV importer constructs the insert inline. This is also the
  only place the supabase client is imported by a page component.
- **Suggested fix**: Add an `importGearItems(rows, userId)` helper in
  `lib/queries.ts` and have the page call it.
- **Risk of fixing**: small.

### M12 · `createListFromSelection` reimplements `createList`
- **Location**: `src/lib/queries.ts` ~line 195 (the new helper) vs ~line 175
  (`createList`).
- **Standard violated**: §1 / DRY.
- **Severity**: medium.
- **Description**: `createListFromSelection` builds the lists insert by hand
  (including share token generation) when it could call `createList` and then
  patch description / insert items. Two paths for the same operation drift.
- **Suggested fix**: Internally call `createList`, follow up with
  `updateList({ description })` if non-null, then bulk-insert list items.
  Or extend `createList` to accept an optional description.
- **Risk of fixing**: small.

### M13 · `addNewItemMut` does 3 round-trips per add
- **Location**: `src/lists/ListDetailPage.tsx` ~line 245.
- **Standard violated**: §5 Performance — query batching / unnecessary
  network.
- **Severity**: medium.
- **Description**: Inserts gear → inserts list_item via `addGearItemToList` →
  conditionally `updateListItem` to set qty/worn/consumable. Three sequential
  round-trips when the user submits the new-item form. On a 200ms RTT that's
  ~600ms before the row appears.
- **Suggested fix**: Either (a) extend `addGearItemToList` to accept the full
  list_item payload (qty + flags), eliminating the third round-trip; or (b)
  do a single `supabase.from('list_items').insert(...)` inline that takes the
  gear id from the just-created gear item.
- **Risk of fixing**: small. (a) is cleaner.

### M14 · `autoFocus` vs `useEffect ref.focus()` inconsistency
- **Location**: `src/lists/ListsBox.tsx` (autoFocus on new-list input,
  useEffect on rename input), `src/components/InlineText.tsx` (useEffect),
  `src/lists/ListDetailPage.tsx` `AddItemRow` (useEffect),
  `src/gear/GearItemDialog.tsx` (autoFocus). Mixed.
- **Standard violated**: §1 forms — consistency.
- **Severity**: medium (low-stakes but confusing).
- **Description**: Two patterns coexist for "focus this input on mount."
  `autoFocus` is simpler and behaves well in our cases (no SSR). The
  `useEffect(() => { ref.current?.focus() }, [])` form is heavier and harder
  to tell at a glance.
- **Suggested fix**: Standardize on `autoFocus`. Use the ref-based form only
  when focus needs to be triggered conditionally after the initial mount
  (e.g. `InlineText` switching from display to edit mode — that one stays).
- **Risk of fixing**: small.

### M15 · `ListDetailInner` has no key on listId, so state persists across switches
- **Location**: `src/lists/ListDetailPage.tsx` line 121 — `<ListDetailInner
  listId={routeId} ... />`.
- **Standard violated**: §3 client state — local state should belong to the
  current entity.
- **Severity**: medium (latent bug; user sees stale draft state).
- **Description**: When the user switches lists via the Lists box, the same
  `ListDetailInner` instance re-renders with a new `listId` prop. Local state
  (`mode`, `sidebarOpen`, `creatingList`, `newListDraft`, `importPreview`,
  `importError`, `confirmDeleteList`, `pendingImportId`, `libraryCollapsed`)
  carries over. Most are harmless (mode, sidebarOpen) but some are surprising
  — e.g. an open import-preview dialog stays open across list switches.
- **Suggested fix**: `<ListDetailInner key={routeId} listId={routeId} ... />`.
  React will unmount the old instance and mount a fresh one on list change.
- **Risk of fixing**: small.

### M16 · `ListDetailPage.tsx` is 1,307 LOC
- **Location**: whole file.
- **Standard violated**: §11 anti-pattern #20 (multi-screen-tall components).
- **Severity**: medium (slows everyone reading the file).
- **Description**: The file is the orchestration root for the entire list-
  detail experience and ten helper components live inside it (`ListDetailInner`,
  `ListCategoryGroup`, `SortableListCategoryGroup`, `PackingProgress`,
  `ImportPreviewDialog`, `TabBtn`, `ModeBtn` is gone, `InlineTitle`,
  `PanelCard`, `NotesEditor`, `AddItemRow`, `PrivacyButton`, `ToggleSwitch`).
  The standards file already calls this out as a known tension; the audit
  records the size and the candidates for extraction.
- **Suggested fix**: Move helpers to their own files (`lists/ListCategoryGroup.tsx`,
  `lists/AddItemRow.tsx`, `lists/PrivacyButton.tsx`, `lists/InlineTitle.tsx`,
  `components/PanelCard.tsx`, `components/ToggleSwitch.tsx`). Don't try to
  break apart `ListDetailInner` itself.
- **Risk of fixing**: medium. Mechanical but touches a lot of imports;
  staged batches recommended.

### M17 · `GearLibraryPage.tsx` is 818 LOC
- **Location**: whole file.
- **Standard violated**: §11 anti-pattern #20.
- **Severity**: medium.
- **Description**: Same shape as M16 but smaller. `ImportPreviewDialog`,
  `BulkMoveCategoryDialog`, `CreateListFromSelectionDialog` are all 50-100
  LOC and could move to their own files.
- **Suggested fix**: Same approach as M16.
- **Risk of fixing**: medium.

---

## Low severity

> Nice-to-have.

### L1 · `listsByRecent` re-sorts on every render
- **Location**: `src/lists/ListDetailPage.tsx` ~line 90.
- **Standard violated**: §5 performance.
- **Severity**: low (cheap; lists ≤100 items).
- **Suggested fix**: Move the sort into `fetchLists` via the SQL `order by`
  clause so the cache is already in the right order. Or memoize.
- **Risk of fixing**: small.

### L2 · `pointer-events-none` overlay missing `aria-hidden` in `ListItemRow`
- **Location**: `src/lists/ListItemRow.tsx` (the trash overlay used to have
  one but was removed when the overlay was simplified). Compared to
  `LibraryPanel` overlay which sets `aria-hidden`.
- **Standard violated**: §8 ARIA hygiene.
- **Severity**: low.
- **Description**: Decorative overlays should be hidden from assistive tech.
- **Suggested fix**: One-line addition.
- **Risk of fixing**: small.

### L3 · Tailwind arbitrary values
- **Location**: `text-[10px]` (multiple), `min-h-[8rem]`, `max-w-[160px]`,
  `max-w-[180px]` (ListsBox kebab), `bg-blue-50/30`, `bg-blue-50/40`.
- **Standard violated**: §9 styling — prefer tokens; comment one-offs.
- **Severity**: low.
- **Suggested fix**: Replace with closest token (e.g. `text-xs`, `min-h-32`).
  Where the arbitrary value is intentional (10px for column labels, 8rem
  textarea baseline), leave a one-line comment.
- **Risk of fixing**: small.

### L4 · ListsBox menu and PrivacyButton popover both manually portal-position
- **Location**: `src/lists/ListsBox.tsx` and the `PrivacyButton` component
  in `src/lists/ListDetailPage.tsx`.
- **Standard violated**: §1 / DRY.
- **Severity**: low.
- **Description**: Both compute trigger `getBoundingClientRect()`, render to
  document.body via portal, listen for outside-click + scroll/resize close.
  Same pattern.
- **Suggested fix**: Extract `usePortalAnchor(triggerRef)` returning
  `{ open, openAt, close, position }` and a `<PortalAnchor>` component for the
  rendered content.
- **Risk of fixing**: medium (touches both components and changes a lot of
  state).

### L5 · `listItems = []` default + `find` for "remove from list"
- **Location**: `src/lists/ListDetailPage.tsx` `onRemove` callback at the
  LibraryPanel and LibrarySheet callsites.
- **Severity**: low.
- **Description**: If the gear→listItem mapping ever has more than one row
  (it shouldn't, but defensive), `find` only removes the first. `filter` +
  bulk delete would be more robust.
- **Suggested fix**: Defer until we add a "quantity from panel adds another
  list_item" feature. Currently a non-issue.
- **Risk of fixing**: small but unnecessary work.

### L6 · `supabase.auth.getSession()` race in `AuthProvider`
- **Location**: `src/auth/AuthProvider.tsx` line 16-29.
- **Severity**: low.
- **Description**: The initial `getSession()` and the `onAuthStateChange`
  subscription both set `session` state. If the auth state changes before the
  initial `getSession` resolves, the listener wins, then the initial promise
  also lands and may overwrite. In practice the values are equal; the
  `setLoading(false)` is the only thing the initial promise must do.
- **Suggested fix**: Wrap `setSession` in the initial promise with an
  `if (!cancelled)` flag. Or just let the listener be the only writer.
- **Risk of fixing**: small.

### L7 · `<button>` elements inside non-form contexts without `type="button"`
- **Location**: many (kebab triggers, drag handles, action buttons).
- **Standard violated**: §1 forms.
- **Severity**: low.
- **Description**: When a `<button>` lacks `type`, it defaults to `submit`
  inside a form. In our codebase most aren't inside forms, so this is
  harmless. The risk is that when someone wraps a region in a `<form>` later,
  every button suddenly submits.
- **Suggested fix**: Add `type="button"` to every non-submit button. Mostly
  consistency / future-proofing.
- **Risk of fixing**: small.

---

## Out of scope (per STANDARDS.md "tensions" section)

These are conscious gaps, not findings:

- No toast system. `text-red-600` inline messages are the bridge.
- Hand-typed Supabase row types in `lib/types.ts` instead of generated.
- No top-level error boundary in `AppShell`.
- No service worker / offline support.
- Custom modal overlays instead of the native `<dialog>` element (covered
  by H5 if we choose to migrate).

---

## Summary

| Severity | Count | Smallest-risk fix first |
|----------|------:|-------------------------|
| High     | 6     | H3 (cast cleanup) |
| Medium   | 17    | M1 (delete dead exports) |
| Low      | 7     | L2 (one-line aria-hidden) |

Recommended Phase-3 batches (just suggestions; you decide):

1. Quick wins (low risk, high readability): M1, M2, M3, M4, M6, L2, L3, L7.
2. DRY pass: M5, M8, M9, M10, M11, M12, L4.
3. Correctness: H1 (mutation error story), H3 / M4 (cast),
   H6 / M7 (AddItemRow blur), M15 (key on ListDetailInner), M13 (round-trip
   reduction).
4. Accessibility: H2 (button rows), H5 (modal a11y), L7 type=button.
5. Optimistic-update hardening: H4.
6. File splits: M16, M17.
