# Split plan — `ListDetailPage.tsx` and `GearLibraryPage.tsx`

Phase 1 analysis. No code changes yet. The goal is to bring both files into the
~400-LOC range from STANDARDS.md §11.20 by extracting clean boundaries — not
by mechanical line-shifting.

Conventions:

- Sub-components and hooks **co-locate** with their feature folder
  (`src/lists/`, `src/gear/`). Standards §6 — keep things near their consumer
  unless they're genuinely shared.
- Cross-feature reusable UI goes to `src/components/`.
- Pure functions go to `src/lib/`.
- A custom hook earns its keep when it bundles state + effects + handlers
  for **one concern** with a name a reader could explain in a sentence.
- A sub-component earns its keep when its interface is ≤ ~6 props and the
  boundary is a clean noun (a dialog, a row, a panel, a footer).

---

## File 1: `src/lists/ListDetailPage.tsx` (1,307 LOC)

Currently houses 12 components / helpers in one file: `ListDetailPage`
(redirect shell), `ListDetailInner` (orchestration root, ~565 LOC),
`ListCategoryGroup`, `SortableListCategoryGroup`, `PackingProgress`,
`ImportPreviewDialog`, `InlineTitle`, `PanelCard`, `NotesEditor`,
`AddItemRow`, `PrivacyButton`, `ToggleSwitch`.

### Sub-component extractions

| Name | New path | LOC | Boundary | Best practice | What it improves | Risk |
|------|----------|----:|----------|---------------|------------------|------|
| `ListCategoryGroup` (+ `SortableListCategoryGroup`) | `src/lists/ListCategoryGroup.tsx` | ~150 | clean — already has a `GroupProps` interface; sortable wrapper pairs with it | single responsibility (one category section) | readability, can be unit-tested with mock props | small |
| `PackingProgress` | `src/lists/PackingProgress.tsx` | ~45 | clean — 3 props (`total`, `packed`, `onReset`) | single responsibility | readability | small |
| `ListImportPreviewDialog` | `src/lists/ListImportPreviewDialog.tsx` | ~85 | clean — 4 props (`rows`, `saving`, `onConfirm`, `onClose`) | one dialog per file (standards §1) | readability, parallels gear lib's import preview | small |
| `InlineTitle` | `src/lists/InlineTitle.tsx` | ~45 | clean — 2 props; the click-to-edit gesture is an exact mirror of `InlineText` (specialized for the page heading) | single responsibility | readability; potential future merge with `InlineText` if styling reconciles | small |
| `NotesEditor` | `src/lists/NotesEditor.tsx` | ~25 | clean — 2 props (`initial`, `onSave`); blur-to-save | single responsibility | readability | small |
| `AddItemRow` | `src/lists/AddItemRow.tsx` | ~120 | clean — 2 props (`onSubmit`, `onCancel`); contains a self-contained draft form | single responsibility, co-location | readability; AddItemData type co-locates with its consumer | small |
| `PrivacyButton` (carries `ToggleSwitch`) | `src/lists/PrivacyButton.tsx` | ~130 | clean — 1 prop (`list`); owns its own popover positioning, mutation, copy state | self-contained widget | readability; `ToggleSwitch` becomes a private helper inside the same file | small |

`PanelCard` is **not extracted** — see Rejected.

### Hook extractions

| Name | New path | LOC | Boundary | Best practice | What it improves | Risk |
|------|----------|----:|----------|---------------|------------------|------|
| `useWeightUnit()` | `src/lib/weight.ts` (extend the existing module) or `src/lib/use-weight-unit.ts` | ~10 | clean — wraps `getWeightUnit`/`setWeightUnit` + `useState` so component code is `const [weightUnit, toggleWeightUnit] = useWeightUnit()`. Same hook used in `GearLibraryPage`. | DRY across two pages | one localStorage-bound state shape, one source of truth | small |
| `usePendingImport(listId, openPicker)` | inline in `src/lists/ListDetailPage.tsx` (don't extract) | — | — | — | — | — |

`usePendingImport` is **not extracted** — see Rejected.

### Pure function extractions

| Name | New path | LOC | Boundary | Best practice | What it improves | Risk |
|------|----------|----:|----------|---------------|------------------|------|
| `groupListItemsByCategory(items, categories)` | `src/lib/grouping.ts` (new) | ~15 | clean — input: `(ListItemWithGear[], Category[])`; output: `{ category, items }[]` with uncategorised at the end. Currently inline at the top of `ListDetailInner`'s render. The same shape is duplicated in `SharePage`. | DRY | testability + can replace duplicated logic in `SharePage.tsx` later | small |
| `assignSortOrderSlots(reorderedItems)` | `src/lib/grouping.ts` (same module) | ~6 | clean — input: array of items with `sort_order`; output: `{id, sort_order}[]` with the existing slot values redistributed. Currently inline in `handleItemsReorder`. | testability | reorder math becomes unit-testable | small |

### Recommended extractions (in order)

1. **Pure functions first** (lowest risk, no React state to carry):
   - `groupListItemsByCategory` and `assignSortOrderSlots` to `src/lib/grouping.ts`.
2. **Stateless sub-components** (just props in, JSX out):
   - `PackingProgress`, `NotesEditor`, `InlineTitle`, `PanelCard` (defer per Rejected — see below).
3. **Stateful sub-components**:
   - `AddItemRow`, `PrivacyButton` (with private `ToggleSwitch`),
     `ListImportPreviewDialog`.
4. **The big composite**:
   - `ListCategoryGroup` + `SortableListCategoryGroup` (largest single chunk).
5. **Hook**:
   - `useWeightUnit()` — last because it touches both files; do it once, update
     both consumers in the same commit.

### Rejected extractions

- **`PanelCard`** (~13 LOC, used twice in this file): too small to justify its
  own file; the title-strip + body shape is a one-line idiom. Leave inline.
  If a third consumer appears, revisit. (Potential future merge with
  `SharedPanelCard` in `SharePage.tsx` — out of scope here.)

- **`useImportFlow(listId, navigate, openPicker)`** bundling
  `pendingImportId` + the navigate-then-open effect: tempting but the
  pendingImportId is set *outside* the would-be hook (in the kebab menu's
  `onImport`) and the `listId` arrives from the route. Pulling it into a hook
  would force callers to either lift state up further or pass setters back
  out, which is exactly the awkward-glue case the standards warn against.

- **`useListDetailMutations(listId, …)`** wrapping the 14 mutations: the
  individual mutations depend on closure values (`listsByRecent`,
  `gearItems.length`, `categories`, `listItems.length`, etc.) that change as
  the user types or drags. Bundling them into one hook would either (a)
  re-build all 14 mutations on every render (defeating React Query's
  identity stability) or (b) require the consumer to thread a dozen args in
  and a dozen mutations out. The current "mutations defined inline near
  render" pattern is uncomfortable but *cohesive* — they all share the same
  cache invalidation contract and the page is the right scope.

- **Splitting `ListDetailInner` into a header / sidebar / right-column
  trio of components**: tempting on size grounds but every one of those
  sub-components would need most of the same mutations as props. That's a
  prop-drilling antipattern, not an extraction. The render block is verbose
  but flat; readability is fine after the smaller extractions land.

### Estimated LOC after recommended extractions

- Sub-components moved out: ~605 LOC
- Pure functions moved out: ~21 LOC
- Hook moved out: ~10 LOC
- Imports added back: ~10 LOC
- **`ListDetailPage.tsx` ≈ 680 LOC** (down from 1,307)

That's still over the 400 guideline but every remaining line is doing real
orchestration work — query fetches, the 14 mutations, the per-callsite group
prop bundle, the page-level JSX. Further reduction would require the
architectural moves rejected above.

---

## File 2: `src/gear/GearLibraryPage.tsx` (818 LOC)

Currently houses 4 components / helpers: `GearLibraryPage` (~580 LOC),
`CreateListFromSelectionDialog`, `ImportPreviewDialog`,
`BulkMoveCategoryDialog`. Plus a small top-level `groupItems` helper.

### Sub-component extractions

| Name | New path | LOC | Boundary | Best practice | What it improves | Risk |
|------|----------|----:|----------|---------------|------------------|------|
| `CreateListFromSelectionDialog` | `src/gear/CreateListFromSelectionDialog.tsx` | ~100 | clean — 5 props (`selectedCount`, `existingListCount`, `saving`, `onSubmit`, `onClose`); owns its own form draft state | one dialog per file | readability; testable in isolation | small |
| `GearImportPreviewDialog` | `src/gear/GearImportPreviewDialog.tsx` | ~70 | clean — 4 props; mirrors the list version | one dialog per file | readability | small |
| `BulkMoveCategoryDialog` | `src/gear/BulkMoveCategoryDialog.tsx` | ~50 | clean — 4 props (`categories`, `count`, `onMove`, `onClose`) | one dialog per file | readability | small |
| `BulkActionsToolbar` | `src/gear/BulkActionsToolbar.tsx` | ~50 | acceptable — 5 props (`selectedIds`, `onSelectAll`, `onDeselectAll`, `onCreateList`, `onMove`, `onDelete`); fixed-bottom toolbar that already has its own visual identity | single responsibility | readability; the live cap warning logic stays with the toolbar that owns it | small |

### Hook extractions

| Name | New path | LOC | Boundary | Best practice | What it improves | Risk |
|------|----------|----:|----------|---------------|------------------|------|
| `useWeightUnit()` | shared with ListDetailPage (see above) | ~10 | clean | DRY | shared persisted preference | small |
| `useToggleSet<T>(initial?)` | `src/lib/use-toggle-set.ts` | ~15 | clean — wraps `useState(new Set<T>())` and exposes `{ has, add, remove, toggle, clear, set, values }`. Both `selectedIds` and `collapsed` use the same Set toggle pattern. | DRY, single responsibility | one tested helper instead of two near-identical inline `set.has(id) ? delete : add` blocks | small |
| `useSelectionMode<T>()` | inline in `src/gear/GearLibraryPage.tsx` (don't extract) | — | — | — | — | — |

`useSelectionMode` is **not extracted** — see Rejected.

### Pure function extractions

| Name | New path | LOC | Boundary | Best practice | What it improves | Risk |
|------|----------|----:|----------|---------------|------------------|------|
| `groupItems(items, categories)` (currently top-level in this file) | `src/lib/grouping.ts` (same module as the list version) | ~10 | clean — input: `(GearItem[], Category[])`; output: `{ category: Category \| null, items: GearItem[] }[]`. The list version groups `ListItemWithGear` by `gear_item.category_id`, not directly comparable, but they live next to each other and the file name is a clear "grouping helpers" home. | DRY co-location | one module owns category grouping for both pages | small |

### Recommended extractions (in order)

1. **Pure function**: move `groupItems` to `src/lib/grouping.ts` alongside
   the list version.
2. **Sub-components, smallest first**:
   - `BulkMoveCategoryDialog`, `GearImportPreviewDialog`,
     `CreateListFromSelectionDialog`.
3. **Toolbar**: `BulkActionsToolbar` (introduces a 5-prop interface; verify
   nothing else needs a slice of the toolbar's state before committing).
4. **Hook**: `useToggleSet<T>()` consumed by `selectedIds` and `collapsed`.
5. **Hook (shared)**: `useWeightUnit()` — same commit as the list page.

### Rejected extractions

- **`useSelectionMode`** wrapping `selectMode` + `selectedIds` + the toggle
  helpers + `exitSelectMode`: clean conceptually, but `exitSelectMode` is
  also called inside several mutation `onSuccess` callbacks (`bulkDelete`,
  `bulkMove`, `createListFromSelectionMut`). The hook's exit handler would
  need to be a stable reference threaded through closure context to be
  callable from those mutations without re-creating them. Solvable, but the
  glue isn't free. Defer until after `useToggleSet<T>()` lands; if the page
  feels noisy then, revisit.

- **`useGearMutations(userId, …)`** bundling the 11 mutations: same reason
  as `useListDetailMutations` above — they share closures with `categories`,
  `allItems`, `lists` lengths and the `setDialog` setter. Bundling would
  either re-create them all every render or force ugly setter passing.

- **Splitting `GearLibraryPage`'s render into a `GearLibraryHeader`**:
  the header is ~50 LOC of inline JSX, but it depends on every piece of
  state in the page (`weightUnit`, `selectMode`, `setDialog`, the file
  input). The boundary is messy — flag and skip.

- **A `useGearLibraryFilters()` wrapping `search` + `filteredItems`**: it's
  one `useState` + one `useMemo`. Inlining is clearer than a hook.

### Estimated LOC after recommended extractions

- Sub-components moved out: ~270 LOC
- Pure function moved out: ~10 LOC
- Hook adoption: ~−15 LOC net (collapsed + selectedIds use the helper)
- Imports added back: ~5 LOC
- **`GearLibraryPage.tsx` ≈ 530 LOC** (down from 818)

Still slightly over the 400 guideline. The remaining size is the page's 11
mutations + the orchestration JSX, which is genuinely cohesive.

---

## Lessons

A few principles that drive when to extract and when to leave things alone.

**Extract when there's a clear boundary, not a tall component.** Line count
is a smell, not a rule. A 600-line component with a coherent narrative is
easier to read than a 200-line component glued to four helper files with
prop-drilling between them. The right question is "could a stranger explain
this piece's job in one sentence?" If yes, extracting helps. If no — if the
boundary requires explanation — extracting only relocates the confusion.

**Hooks are for state + effects + handlers that share one concern.** A hook
should hide a cohesive *mechanism*: a draft form, a focus trap, a polling
loop, a selection set. If you'd find yourself returning seven unrelated
values to satisfy a caller, you're packaging things up rather than
extracting a concern. The TanStack Query mutations in these files are a
good example — they look like a hook candidate (lots of state + handlers)
but they're really 14 independent mutations that happen to live next to
each other. Bundling them into one hook would obscure their independence.

**Sub-components should have ≤ ~6 props.** A wide prop interface is the
clearest signal that the boundary is in the wrong place. When a component
needs ten props to function, two things are usually true: (a) the parent
has too much state that the child cares about, and (b) the child's
"single responsibility" is actually three. Either lift the boundary up
(make a thinner sub-component that owns less) or push the boundary down
(let a deeper child take direct responsibility).

**Cohesion over coupling, but not at any cost.** Cohesion is "things that
change together live together." Coupling is "things that depend on each
other." A high-cohesion module is easy to change without breaking other
modules. A loosely-coupled architecture lets you change one piece without
touching others. The two pull in the same direction *most* of the time but
sometimes conflict — and when they do, cohesion usually wins for product
code. The 14 mutations in `ListDetailInner` are tightly coupled to the
page's local state and the cache key shape. Pulling them apart would lower
coupling but also lower cohesion ("when I add a new mutation, where does it
go?"). The page is the right scope for that cluster — even though it makes
the file longer.

**The "awkward glue" test is your friend.** When you imagine the call site
of an extracted hook or component, does it feel natural? Does the parent
have to thread setters back into the hook to make it useful? Does the
component need a `key` to reset state because the hook keeps stale data
around? If the integration code looks worse than the original inline code,
the extraction is wrong — even if each piece reads better in isolation.

**Pure functions are almost always worth extracting.** Anything with no
React, no I/O, and no time dependency wants to be in `lib/`. They're
trivial to test, easy to share, and never carry hidden lifecycle
assumptions. The grouping logic and the slot-shuffle math here are
textbook cases. If a piece of code can be a pure function, make it one.

**Co-location is the default; promotion to "shared" is earned.** The
standards point at this directly: hooks and components live next to the
feature that owns them until a second consumer appears. Premature promotion
to a generic `components/` or `hooks/` directory is one of the most common
ways large React codebases drift toward "spaghetti by category." A hook
named `useToggleSet` is generic enough to live in `lib/` from day one — but
`useGearLibrarySelection` should sit in `gear/` until something outside
gear needs it.

**Rejected extractions teach more than accepted ones.** The instinct is to
extract everything that's locally extractable — a 50-line piece "could be
its own component," a useEffect "could be a hook." The discipline is to
notice when the extraction would create awkward seams between the pieces.
The toolbar's bulk actions look extractable, but they all share the same
selection set and the same dialog state setter; pulling the toolbar out is
fine, but pulling the selection state out is not. The selection state is
tightly wound with mutations that consume it. Two lines of "rejected
extraction" notes save the next person from making the same mistake.

**Refactor incrementally, verify often.** Pure functions first because they
can't break runtime behavior. Stateless components next because their
contracts are obvious from props. Stateful components after that because
they sometimes carry hidden assumptions about parent state. Hooks last
because they have the most subtle integration concerns. After each step,
build + lint + manual smoke. If a batch grows past ~30 lines of changes
for a small-risk extraction, stop and reassess — you've probably crossed
into a different category of work.

**The goal is judgment, not a smaller number.** This file is "1,307 LOC"
because the file size guideline is a useful prompt, not because LOC is the
metric. After the recommended extractions, `ListDetailPage.tsx` will still
be ~680 LOC. That's fine. Each line that remains is doing work that can't
honestly live elsewhere without inventing seams.

---

Sources consulted while writing this plan:

- [React docs — Reusing logic with custom hooks](https://react.dev/learn/reusing-logic-with-custom-hooks)
- [Robin Wieruch — React folder structure](https://www.robinwieruch.de/react-folder-structure/)
- [Josh Comeau — React file/directory structure](https://www.joshwcomeau.com/react/file-structure/)
- [DEV — Separation of concerns with custom React hooks](https://dev.to/areknawo/separation-of-concerns-with-custom-react-hooks-3aoe)
- [patterns.dev — Hooks pattern](https://www.patterns.dev/react/hooks-pattern/)
- [CodeScene — Refactoring components in React with custom hooks](https://codescene.com/blog/refactoring-components-in-react-with-custom-hooks)
