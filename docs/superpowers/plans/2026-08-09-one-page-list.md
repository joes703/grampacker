# One-Page List Implementation Plan

> **DATED RECORD, not binding.** An implementation plan, written before the
> work and not updated after it. The instructions below were live WHEN IT WAS
> WRITTEN; do not follow them now. Read it for reasoning, and check the code
> for what actually shipped.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a list's gear work finishable without changing pages - the gear picker sits beside both the Category and Pack arrangements, new items can be created from either, and Pack rows finally show a weight and can be edited.

**Architecture:** No new components except one control. `ListDetailPage` already renders all three views from one component with the mode derived from the URL, so this is composition changes at existing seams: widen and re-gate the left `<aside>`, retarget the Pack "Add gear" button to the width band the aside does not cover, add a weight cell to the two Pack row components, thread a new `onEdit` callback into `MoveToLocationMenu`, and host `QuickAddItemModal` from `LibraryPanel`.

**Tech Stack:** React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), React Router, TanStack Query v5, Tailwind v4, Vitest + Testing Library, no new dependencies.

**Spec:** `docs/one-page-list-design.md` (revised after Codex plan review, VERDICT: MERGE-WITH-FIXES).

## Global Constraints

- Branch: `one-page-list` (already exists, holds the three design commits).
- Zero server changes, zero migrations, no new API calls, `docs/authz-matrix.md` untouched. The only mutation used (`quickAddListItem`) already exists.
- Gates per AGENTS.md: `npm run build` AND `npm run test:unit` before claiming any task done. `npm run test:api` is unaffected (no `server/**` change) - do not run it.
- `noUncheckedIndexedAccess` is on: indexed access returns `T | undefined`. Use `.find()`, destructuring with defaults, or length guards - never bare `!` without a comment saying why.
- Tailwind v4 scans whole class tokens only. `${mode === 'pack' ? 'xl:flex' : 'lg:flex'}` is safe because both branches are complete tokens. Never interpolate a class *fragment* (`` `${size}:flex` ``) - it silently produces no CSS.
- UI vocabulary per `docs/ui-density.md`: `ItemWeightValue` styles nothing, always wrap it in `FLAT_TABLE_NUMERIC_TEXT`. Never hand-roll a `text-*`/`px-*`/`rounded-*` recipe a token owns.
- No fire-and-forget promises. An async handler invoked without `await`/`.catch` must catch internally.
- A toast raised while a `<dialog>` is open renders behind it. Close a modal before its mutation settles, or report inline.
- US spelling, ASCII in code, comments and commit messages. No formatter - match surrounding style by hand.
- Stage exact files (`git add <paths>`), never `-A` or `.`. One logical change per commit.
- Do NOT run `/codex:adversarial-review` - it is user-invoked only. GATE 2 is Joe's to trigger.

---

## Task 1: The picker renders beside Pack

**Files:**
- Modify: `src/lists/ListDetailPage.tsx:1917-1949`
- Test: `src/lists/ListDetailPage.pack.test.tsx`

**Interfaces:**
- Produces: no new exports. The `<aside>` gains `data-testid="list-side-panel"` so tests can assert its responsive classes without depending on DOM shape.

**Context:** The aside is gated on `mode === 'edit'` and is `hidden lg:flex w-80`. Pack compensates for its absence by centering the document at `max-w-3xl`. Per the spec, Pack's aside starts at `xl` (1280px), not `lg` - at 1024px the document is 656px and item names truncate to roughly 113px. `max-w-3xl` is unprefixed so it also governs print; it is preserved for print only.

- [ ] **Step 1: Write the failing tests**

Add to `src/lists/ListDetailPage.pack.test.tsx`. Follow the file's existing render helper and mock setup - do not invent a new harness.

```tsx
it('renders the gear picker aside in pack mode, gated at xl', async () => {
  await renderPackView()
  const aside = await screen.findByTestId('list-side-panel')
  expect(aside.className).toContain('xl:flex')
  expect(aside.className).not.toContain('lg:flex')
})

it('keeps the pack document unconstrained on screen but 3xl in print', async () => {
  await renderPackView()
  const doc = await screen.findByTestId('list-document-column')
  expect(doc.className).toContain('print:max-w-3xl')
  expect(doc.className).not.toMatch(/(^|\s)max-w-3xl(\s|$)/)
})

it('hides the lists switcher in pack mode', async () => {
  await renderPackView()
  expect(await screen.findByTestId('list-side-panel')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Lists' })).not.toBeInTheDocument()
})
```

If `renderPackView` does not already exist in that file, add it modeled on the existing pack render setup, and assert the heading name against whatever `DesktopListsPanel` actually renders - read it rather than trusting `'Lists'`.

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run src/lists/ListDetailPage.pack.test.tsx`
Expected: FAIL - `Unable to find an element by: [data-testid="list-side-panel"]`.

- [ ] **Step 3: Re-gate and widen the aside**

Replace the aside opening at `ListDetailPage.tsx:1923-1935`:

```tsx
{(mode === 'edit' || mode === 'pack') && (
  <aside
    data-testid="list-side-panel"
    // Pack's aside starts at xl, Category's at lg. At 1024px a 320px aside
    // leaves 656px for the document, and a pack row (grip, two checkboxes,
    // name, description, two icon slots, quantity, weight, menu) truncates
    // the name to ~113px rather than overflowing - the information
    // disappears silently. Category rows are far less dense and are fine
    // at lg. Between lg and xl, Pack reaches the picker through the
    // drawer button (see the Add gear control below).
    className={`hidden ${mode === 'pack' ? 'xl:flex' : 'lg:flex'} w-80 xl:w-96 shrink-0 flex-col gap-3 sticky self-start print:hidden`}
    style={{ top: '1rem', height: 'calc(100vh - 2rem)' }}
  >
    {/* Category only: nobody switches lists mid-pack, and max-h-72 is
        height the picker wants back. */}
    {mode === 'edit' && (
      <DesktopListsPanel
        lists={lists}
        currentListId={listId}
        className="shrink-0 max-h-72"
      />
    )}
```

- [ ] **Step 4: Make the document column print-only-narrow**

Replace `ListDetailPage.tsx:1949`:

```tsx
<div
  data-testid="list-document-column"
  // On screen Pack now has the aside back, so the centering that
  // compensated for its absence is wrong. max-w-3xl is unprefixed and
  // therefore also governs print, where the checklist should keep its
  // current 768px measure - so it is retained under print: only.
  className={`flex-1 min-w-0 space-y-4 ${mode === 'pack' ? 'print:max-w-3xl print:mx-auto' : ''}`}
>
```

- [ ] **Step 5: Update the stale layout comment**

The comment at `ListDetailPage.tsx:1915-1922` says the sidebar renders only in Edit and "Pack stays focused". Replace it with what is now true: the aside serves Category from `lg` and Pack from `xl`, and Pack's focus argument lost to the trip evidence in `docs/one-page-list-design.md`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lists/ListDetailPage.pack.test.tsx`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 7: Full gate**

Run: `npm run build && npm run test:unit`
Expected: exit 0 both.

- [ ] **Step 8: Commit**

```bash
git add src/lists/ListDetailPage.tsx src/lists/ListDetailPage.pack.test.tsx
git commit -m "feat: the gear picker sits beside Pack, from xl up"
```

---

## Task 2: The Add gear button covers lg to xl

**Files:**
- Modify: `src/lists/ListDetailPage.tsx:2055-2065`
- Test: `src/lists/ListDetailPage.pack.test.tsx`

**Interfaces:**
- Consumes: the aside from Task 1 (`xl:flex` in Pack).
- Produces: nothing new.

**Context:** The button is gated on `mode === 'pack' && !isBelowLg`, i.e. 1024px and up, and opens the picker in a drawer. With Task 1's aside starting at `xl`, deleting the button would leave 1024-1279px with no path to the picker at all: `useIsBelowLg()` is false there, so `MobileListActionBar`'s Add is hidden too (`use-breakpoint.ts:7`, `MobileListActionBar.tsx:48`). The handoff becomes CSS-only - no new JS breakpoint.

- [ ] **Step 1: Write the failing test**

```tsx
it('keeps the Add gear drawer trigger for the lg-to-xl band only', async () => {
  await renderPackView()
  const trigger = await screen.findByRole('button', { name: /add gear/i })
  const band = trigger.closest('div')
  expect(band?.className).toContain('lg:flex')
  expect(band?.className).toContain('xl:hidden')
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lists/ListDetailPage.pack.test.tsx -t "lg-to-xl"`
Expected: FAIL - the wrapper has `flex` with no `xl:hidden`.

- [ ] **Step 3: Retarget the button**

Replace the condition and wrapper at `ListDetailPage.tsx:2055-2056`:

```tsx
{mode === 'pack' && (
  <div className="print:hidden hidden lg:flex xl:hidden justify-end">
```

Delete the `!isBelowLg` term. Rewrite the comment above it: below `lg` the action bar carries Add; from `lg` to `xl` this button is the only path to the picker; at `xl` the aside is on screen and this would be a second control for a visible surface.

- [ ] **Step 4: Check whether `isBelowLg` is now unused**

Run: `grep -n "isBelowLg" src/lists/ListDetailPage.tsx`
If it still has other consumers (it does - `MoveToLocationMenu` takes `mobile={isBelowLg}`), leave the binding alone. Do not remove it speculatively.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lists/ListDetailPage.pack.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full gate and commit**

```bash
npm run build && npm run test:unit
git add src/lists/ListDetailPage.tsx src/lists/ListDetailPage.pack.test.tsx
git commit -m "fix: keep the Add gear drawer trigger for 1024-1279px"
```

---

## Task 3: Pack rows show a weight

**Files:**
- Modify: `src/lists/ItemRow.tsx:292-297` (pack branch, after the quantity cell)
- Modify: `src/lists/SortableFoodRow.tsx:136-139`
- Modify: `src/lists/CategoryGroup.tsx:103` (`PackFoodRowProps`), `:621` (food `rowPropsFor`)
- Test: `src/lists/ItemRow.test.tsx`, `src/lists/ListDetailPage.pack-food.test.tsx`

**Interfaces:**
- Produces: `PackFoodRowProps` gains `weightUnit: WeightUnit`. `SortableFoodRow`'s `Props` gains `weightUnit: WeightUnit`. Both are required, not optional - a missing unit would silently format grams wrong.

**Context:** The Pack branch of `ItemRow` renders no weight at all. Category's weight cell is `w-24` (`ItemRow.tsx:482`). Two constraints from the review:

1. The cell must be a **sibling after** the wrapping `<label>`, where the existing menu sits. Inside the label it becomes part of the click-to-toggle-Packed gesture (`ItemRow.tsx:230`).
2. It is `print:hidden`. `max-w-3xl` is preserved for print by Task 1, so the printed checklist keeps its geometry only if the new cell does not appear on paper.

**Decision, and a narrowing of the spec:** the cell renders at `lg+` only (`hidden lg:inline-block`), matching how the pack row already drops its description below `lg`. A `w-24` cell on a 375px pack row would crush the name, and the mobile pack row is already the densest surface in the app. Mobile Pack keeps today's layout. Amend `docs/one-page-list-design.md` section 3.5 to say so rather than leaving the plan and spec disagreeing.

- [ ] **Step 1: Write the failing tests**

In `src/lists/ItemRow.test.tsx`, following the file's existing render helper:

```tsx
it('shows the weight on a pack row, outside the packed-toggle label', () => {
  renderItemRow({ packMode: true, item: makeItem({ weightGrams: 1200 }) })
  const weight = screen.getByText('1.2 kg')
  expect(weight.closest('label')).toBeNull()
  expect(weight.closest('span')?.className).toContain('print:hidden')
})

it('does not let the pack weight cell toggle packed', async () => {
  const onUpdate = vi.fn()
  renderItemRow({ packMode: true, item: makeItem({ weightGrams: 1200 }), onUpdate })
  await userEvent.click(screen.getByText('1.2 kg'))
  expect(onUpdate).not.toHaveBeenCalled()
})
```

Verify `'1.2 kg'` against `formatItemWeight` before trusting it - the formatter is authoritative, not this plan. Read `src/lib/weight.ts` and match the real output string, including whether it is a narrow no-break space.

In `src/lists/ListDetailPage.pack-food.test.tsx`:

```tsx
it('gives food rows the same weight cell as gear rows in a bag', async () => {
  await renderPackViewWithFood()
  const foodWeight = await screen.findByTestId('pack-food-weight')
  expect(foodWeight.className).toContain('w-24')
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lists/ItemRow.test.tsx src/lists/ListDetailPage.pack-food.test.tsx`
Expected: FAIL - no weight text in the pack row.

- [ ] **Step 3: Add the cell to the gear pack row**

In `ItemRow.tsx`, between the quantity cell (`:292-294`) and `{rowAction}` (`:297`):

```tsx
{/* Weight. A SIBLING of the label above, never inside it: the label wraps
    the Packed checkbox, so a click on anything within it toggles packed
    (ItemRow.tsx wrapping-label comment). lg+ only - the mobile pack row
    already drops its description for room and a w-24 cell would crush the
    name. print:hidden keeps the paper checklist's geometry unchanged. */}
<span className={`hidden lg:inline-block shrink-0 w-24 text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500 print:hidden`}>
  <ItemWeightValue grams={itemWeight} unit={weightUnit} />
</span>
```

`itemWeight` is already bound at `:128`; confirm it is in scope in the pack branch and bind it there if not.

- [ ] **Step 4: Thread the unit to food rows**

In `CategoryGroup.tsx`, add `weightUnit: WeightUnit` to `PackFoodRowProps` (`:103`) and pass `weightUnit` in the food `rowPropsFor` object literal (`:621`). `weightUnit` is already a `CategoryGroup` prop (`:114`).

In `SortableFoodRow.tsx`, add `weightUnit: WeightUnit` to `Props`, destructure it, import `ItemWeightValue` and `FLAT_TABLE_NUMERIC_TEXT`, and insert the same cell between the quantity span (`:136-138`) and `{rowAction}`:

```tsx
<span
  data-testid="pack-food-weight"
  className={`hidden lg:inline-block shrink-0 w-24 text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500 print:hidden`}
>
  <ItemWeightValue grams={food.weightGrams} unit={weightUnit} />
</span>
```

Without this, a bag holding both gear and food renders misaligned columns.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lists/ItemRow.test.tsx src/lists/ListDetailPage.pack-food.test.tsx src/lists/ListDetailPage.pack.test.tsx`
Expected: PASS.

- [ ] **Step 6: Amend the spec**

Edit `docs/one-page-list-design.md` section 3.5 and section 6 to state the `lg+`-only decision and why.

- [ ] **Step 7: Full gate and commit**

```bash
npm run build && npm run test:unit
git add src/lists/ItemRow.tsx src/lists/SortableFoodRow.tsx src/lists/CategoryGroup.tsx src/lists/ItemRow.test.tsx src/lists/ListDetailPage.pack-food.test.tsx docs/one-page-list-design.md
git commit -m "feat: pack rows show a weight, gear and food alike"
```

---

## Task 4: Editing an item from Pack

**Files:**
- Modify: `src/lists/MoveToLocationMenu.tsx` (`BaseProps`, the `rows` fragment)
- Modify: `src/lists/ListDetailPage.tsx:1664-1712` (`renderPackRowAction`), `:1768-1777` (`renderWornPackRowAction`), `:1794-1816` (container header menu)
- Test: `src/lists/MoveToLocationMenu.test.tsx`, `src/lists/ListDetailPage.pack.test.tsx`

**Interfaces:**
- Consumes: `sharedGroupProps.onEditGearItem(gearId: string) => void` (`ListDetailPage.tsx:1619`), which resolves the gear item and its list item and opens `GearItemDialog`.
- Produces: `MoveToLocationMenu` `BaseProps` gains `onEdit?: () => void`. Optional, because food rows deliberately do not get it.

**Context and a rule this overturns.** Two comments currently state the opposite of what this task does:

- `MoveToLocationMenu.tsx:46-52`: "This stays a MEMBERSHIP operation... **Authoring gear belongs to the library, not to a packing checklist.**"
- `ListDetailPage.tsx:1702`: "Membership, not authoring".

That rule is being deliberately overturned - Joe's trip showed that adjusting a weight mid-pack is exactly the thing that forced the three-tab shuffle. **Update both comments** to say authoring is now reachable from Pack via the dialog, and why. Leaving them in place would make the code contradict itself.

Pack has three gear row shapes and the contract "Pack rows can be edited" is only true if all three reach it. Food rows are excluded on purpose: food is authored in the Food view, which is the same reason `renderFoodRowAction` passes no `onRemoveFromList` (`ListDetailPage.tsx:1714-1717`).

- [ ] **Step 1: Write the failing tests**

In `src/lists/MoveToLocationMenu.test.tsx`:

```tsx
it('offers Edit item when onEdit is provided', async () => {
  const onEdit = vi.fn()
  renderMenu({ onEdit })
  await userEvent.click(screen.getByRole('button', { name: /move|options/i }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edit item' }))
  expect(onEdit).toHaveBeenCalledTimes(1)
})

it('omits Edit item when onEdit is absent', async () => {
  renderMenu({})
  await userEvent.click(screen.getByRole('button', { name: /move|options/i }))
  expect(screen.queryByRole('menuitem', { name: 'Edit item' })).not.toBeInTheDocument()
})
```

Read the existing tests in that file for the real trigger accessible name and the real `RowMenuItem` role before trusting the selectors above.

In `src/lists/ListDetailPage.pack.test.tsx`:

```tsx
it('opens the gear dialog from an ordinary pack row', async () => {
  await renderPackView()
  await userEvent.click(screen.getAllByRole('button', { name: /move .* to/i })[0]!)
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edit item' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

it('offers an edit control on a worn pack row', async () => {
  await renderPackViewWithWornItem()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit Wool shirt' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

it('offers Edit item on a container section header', async () => {
  await renderPackViewWithContainer()
  await userEvent.click(await screen.findByRole('button', { name: /options for Backpack/i }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edit item' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lists/MoveToLocationMenu.test.tsx src/lists/ListDetailPage.pack.test.tsx`
Expected: FAIL - no `Edit item` menu item exists.

- [ ] **Step 3: Add `onEdit` to the menu**

In `MoveToLocationMenu.tsx`, add to `BaseProps`:

```tsx
  /** Opens the gear dialog for this row. Pack used to be membership-only -
   *  see the note on onRemoveFromList - but adjusting a weight mid-pack was
   *  one of the jobs that forced a three-view shuffle, so authoring is now
   *  reachable here. Optional: food rows pass none, because food is authored
   *  in the Food view. */
  onEdit?: () => void
```

Destructure it, and add a row at the TOP of the `rows` fragment, above the `onStartReorder` block, followed by its own divider:

```tsx
{onEdit ? (
  <>
    <RowMenuItem
      icon={<Pencil size={13} />}
      disabled={disabled}
      onClick={() => {
        close()
        onEdit()
      }}
    >
      Edit item
    </RowMenuItem>
    <div className="my-1 border-t border-gray-100" />
  </>
) : null}
```

Import `Pencil` from `lucide-react`. Rewrite the `onRemoveFromList` doc comment at `:46-52` so it no longer claims authoring is out of scope for this menu - it still describes removal as membership-only, which remains true.

- [ ] **Step 4: Wire ordinary rows**

In `renderPackRowAction` (`ListDetailPage.tsx:1670`), add:

```tsx
onEdit={() => sharedGroupProps.onEditGearItem(item.gearItem.id)}
```

If `sharedGroupProps` is not in scope at that point, call the same body the memo uses - do not duplicate the lookup logic; hoist it to a `useCallback` above both and use it in both places. Update the "Membership, not authoring" comment at `:1702`.

- [ ] **Step 5: Wire container headers**

In `renderPackingLocationNode` (`ListDetailPage.tsx:1794-1816`), add the same prop to that `MoveToLocationMenu`:

```tsx
onEdit={() => sharedGroupProps.onEditGearItem(containerItem.gearItem.id)}
```

- [ ] **Step 6: Wire worn rows**

Worn rows have no menu - one `RowIconButton` for Remove (`:1768-1777`). Two actions now apply, so add a second button before the existing one rather than converting to a kebab (a kebab would hide the primary Remove behind a click):

```tsx
const renderWornPackRowAction = (item: ListItemWithGear) => (
  <>
    <RowIconButton
      touchSafe
      onClick={() => sharedGroupProps.onEditGearItem(item.gearItem.id)}
      ariaLabel={`Edit ${item.gearItem.name}`}
      title="Edit item"
      icon={<Pencil size={14} />}
    />
    <RowIconButton
      touchSafe
      disabled={itemDragPending}
      onClick={() => requestRemoveListItem(item)}
      ariaLabel={`Remove ${item.gearItem.name} from list`}
      title="Remove from list"
      icon={<Trash2 size={14} />}
    />
  </>
)
```

Update the comment above it: it currently justifies a button over a kebab on the grounds of one applicable action. Two apply now, and the justification becomes "two buttons rather than a kebab, because hiding Remove behind a click is worse than one extra 28px".

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lists/MoveToLocationMenu.test.tsx src/lists/ListDetailPage.pack.test.tsx`
Expected: PASS.

- [ ] **Step 8: Full gate and commit**

```bash
npm run build && npm run test:unit
git add src/lists/MoveToLocationMenu.tsx src/lists/ListDetailPage.tsx src/lists/MoveToLocationMenu.test.tsx src/lists/ListDetailPage.pack.test.tsx
git commit -m "feat: edit an item from Pack, in all three row shapes"
```

---

## Task 5: Create a new item from the picker

**Files:**
- Modify: `src/lists/LibraryPanel.tsx` (props, header, empty-state copy)
- Modify: `src/lists/ListDetailPage.tsx:1532-1547` (`libraryPane`)
- Test: `src/lists/LibraryPanel.test.tsx`, `src/lists/ListDetailPage.edit-gear.test.tsx`

**Interfaces:**
- Consumes: `AddItemData` from `./use-quick-add-form`; `onAddNewItem(categoryId: string | null, data: AddItemData) => void` (`ListDetailPage.tsx:1554`).
- Produces: `LibraryPanel` `Props` gains `onCreateNew?: (data: AddItemData) => void` and `createDisabledReason?: string`. Both optional so the share-adjacent render paths and existing tests keep compiling.

**Context:** `quickAddListItem` creates the `gear_item` and the `list_item` in one atomic call (`use-list-item-actions.ts:190`) and computes nothing from the cached collection, so `membershipUnknown` is not the relevant gate. The relevant risk is different: the picker mounts OUTSIDE the detail loading/error gate (`ListDetailPage.tsx:1962`), so a successful write could land while the document says it could not load and the user has no way to confirm it. Hence `createDisabledReason`.

`QuickAddItemModal` has no pending or inline-error API, and a toast raised over an open `<dialog>` renders behind it. The modal therefore closes before the mutation is fired.

**Where a new item lands** - assert these, they are easy to get backwards: Category view -> Uncategorized. Pack with no bags yet -> Pack falls back to category grouping (`packing-grouping.ts:14`), so also Uncategorized. Pack with bags -> Unassigned. Worn items -> the Worn section either way.

- [ ] **Step 1: Write the failing tests**

In `src/lists/LibraryPanel.test.tsx`:

```tsx
it('creates a new item from the picker', async () => {
  const onCreateNew = vi.fn()
  renderPanel({ onCreateNew })
  await userEvent.click(screen.getByRole('button', { name: 'New item' }))
  await userEvent.type(screen.getByLabelText(/^Name/), 'Titanium spork')
  await userEvent.click(screen.getByRole('button', { name: /save|add/i }))
  expect(onCreateNew).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Titanium spork' }),
  )
})

it('closes the modal before the mutation settles', async () => {
  const onCreateNew = vi.fn()
  renderPanel({ onCreateNew })
  await userEvent.click(screen.getByRole('button', { name: 'New item' }))
  await userEvent.type(screen.getByLabelText(/^Name/), 'Titanium spork')
  await userEvent.click(screen.getByRole('button', { name: /save|add/i }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('disables New item with a stated reason when the list has not loaded', async () => {
  renderPanel({ onCreateNew: vi.fn(), createDisabledReason: "Couldn't load this list's items." })
  const button = screen.getByRole('button', { name: 'New item' })
  expect(button).toBeDisabled()
  expect(button).toHaveAccessibleDescription("Couldn't load this list's items.")
})
```

Read `QuickAddItemModal`'s actual submit button label and `FormLabel` output before trusting the selectors.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lists/LibraryPanel.test.tsx`
Expected: FAIL - no `New item` button.

- [ ] **Step 3: Add the control to `LibraryPanel`**

Add to `Props`:

```tsx
  /** Creates a gear item and this list's row for it in one call. Absent on
   *  render paths that have no list to add to. */
  onCreateNew?: (data: AddItemData) => void
  /** Non-empty when creation is unavailable - the button is disabled and
   *  this is its accessible description. The picker mounts outside the
   *  page's detail gate, so without this a write could succeed while the
   *  document says it could not load and the user cannot see the result. */
  createDisabledReason?: string
```

Add `const [creating, setCreating] = useState(false)` beside the existing `search` state, and put the button in the header block (`:96-109`) beneath the search input. Then, after the header:

```tsx
{creating && onCreateNew && (
  <QuickAddItemModal
    onSubmit={(data) => {
      // Close FIRST. The modal has no pending or inline-error surface, and
      // a toast raised over an open <dialog> renders behind it, so a
      // failed create would report into a layer the user cannot see.
      setCreating(false)
      onCreateNew(data)
    }}
    onClose={() => setCreating(false)}
  />
)}
```

Import `QuickAddItemModal`, `AddItemData`, and `Plus` from `lucide-react`. Use `PrimaryButton` or the existing button vocabulary from `flat-table-styles` - do not hand-roll a recipe.

- [ ] **Step 4: Update the empty-state copy**

`LibraryPanel.tsx:129` reads "Add it on the Gear page, then return here." That is no longer the only path. Change it to point at the New item button when `onCreateNew` is present, and keep the Gear-page wording when it is not. Update the comment at `:119-124` too.

- [ ] **Step 5: Wire it from the page**

In `libraryPane` (`ListDetailPage.tsx:1532`):

```tsx
onCreateNew={(data) => onAddNewItem(null, data)}
createDisabledReason={
  detailDataError
    ? "Couldn't load this list, so a new item could not be confirmed."
    : detailDataLoading
      ? 'Still loading this list.'
      : undefined
}
```

`onAddNewItem` is defined at `:1554` and passes `categoryId` through to the mutation; `null` is Uncategorized, which is the documented destination.

- [ ] **Step 6: Add the destination test**

In `src/lists/ListDetailPage.edit-gear.test.tsx` (or the pack test file, wherever the existing quick-add coverage lives - grep for `quickAddListItem` first):

```tsx
it('creates from the picker with a null category, never a location id', async () => {
  const { quickAdd } = await renderPackViewWithBags()
  await userEvent.click(screen.getByRole('button', { name: 'New item' }))
  await userEvent.type(screen.getByLabelText(/^Name/), 'Titanium spork')
  await userEvent.click(screen.getByRole('button', { name: /save|add/i }))
  expect(quickAdd).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ categoryId: null }),
  )
})
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/lists/LibraryPanel.test.tsx src/lists/ListDetailPage.edit-gear.test.tsx`
Expected: PASS.

- [ ] **Step 8: Full gate and commit**

```bash
npm run build && npm run test:unit
git add src/lists/LibraryPanel.tsx src/lists/ListDetailPage.tsx src/lists/LibraryPanel.test.tsx src/lists/ListDetailPage.edit-gear.test.tsx
git commit -m "feat: create a new item straight from the gear picker"
```

---

## Task 6: List becomes Category

**Files:**
- Modify: `src/lists/list-detail-mode.ts:17-21` (`LIST_VIEW_LABELS`)
- Modify: `src/lists/ListViewNav.tsx:5-9` (`VIEWS`)
- Test: `src/lists/list-detail-mode.test.ts`, `src/lists/ListViewNav.test.tsx`

**Interfaces:**
- Produces: `listDocumentTitle(name, 'edit')` returns `` `${name} - Category` ``.

**Context:** The label lives in two independent places. `LIST_VIEW_LABELS` feeds the document title; `ListViewNav`'s own `VIEWS` array feeds the segmented control. Changing one leaves the other stale. **URLs do not change** - `/lists/:id` stays the Category view, so bookmarks, the stored last-list path and the legacy `/organize` redirect all keep working and no persisted-path migration is needed. The `ListDetailMode` union keeps its `'edit'` member; only the human-facing string changes.

- [ ] **Step 1: Update the two tests first**

In `src/lists/list-detail-mode.test.ts`, change the `listDocumentTitle` expectation for `'edit'` from `'... - List'` to `'... - Category'`. In `src/lists/ListViewNav.test.tsx`, change the link name from `List` to `Category`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lists/list-detail-mode.test.ts src/lists/ListViewNav.test.tsx`
Expected: FAIL on both.

- [ ] **Step 3: Change both label sites**

`list-detail-mode.ts`: `edit: 'Category'`.
`ListViewNav.tsx`: `{ mode: 'edit', label: 'Category' }`.

- [ ] **Step 4: Prove no third site exists**

Run: `grep -rn "'List'" src/lists src/layout --include=*.ts --include=*.tsx | grep -v test`
Expected: no remaining view-label literal. Investigate any hit before dismissing it.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lists/`
Expected: PASS. Other files may assert the old label - fix each, do not skip.

- [ ] **Step 6: Full gate and commit**

```bash
npm run build && npm run test:unit
git add src/lists/list-detail-mode.ts src/lists/ListViewNav.tsx src/lists/list-detail-mode.test.ts src/lists/ListViewNav.test.tsx
git commit -m "feat: the first view is called Category, not List"
```

---

## Task 7: Gates, browser check, and the PR

- [ ] **Step 1: Full gate**

Run: `npm run build && npm run test:unit`
Expected: exit 0 both. `npm run test:migrations` is not needed - nothing under `migrations/` or the schema changed. Do not run `npm run test:api`; no `server/**` file was touched.

- [ ] **Step 2: Browser verification**

Run `npm run dev` and check, at 1024px, 1280px and 375px:

- 1280px Pack: picker on the left, no Add gear button, document not centered.
- 1024px Pack: no picker, Add gear button present, drawer opens and adds.
- 375px Pack: unchanged from today - no picker, action bar carries Add, no weight cell.
- Weight appears on gear and food rows in the same bag and the columns line up.
- Edit item opens the dialog from an ordinary row, a worn row, and a container header; saving a new weight updates the row without leaving Pack.
- Clicking a pack row's name still toggles Packed.
- New item in the picker creates an item that appears in Unassigned (bags exist) or Uncategorized (no bags).
- Drag a row between bags and confirm auto-scroll still works with the aside on screen - the one thing Codex flagged as worth a real-browser check.
- Print preview of Pack: 768px measure, no weight column.

- [ ] **Step 3: Review the complete diff**

Run: `git diff main...HEAD`
Confirm no unrelated change rode along, and that the three comments the design overturns were updated rather than left contradicting the code: `MoveToLocationMenu.tsx:46-52`, `ListDetailPage.tsx:1702`, and the aside comment at `ListDetailPage.tsx:1915`.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin one-page-list
gh pr create --title "feat: one page per list - picker beside Category and Pack" --body "<summary + link to docs/one-page-list-design.md>"
```

- [ ] **Step 5: Hand off for GATE 2**

Ask Joe to run `/codex:adversarial-review --base main --background <framing>`. It is user-invoked only - do not attempt it. Name the standing invariants in the framing per CLAUDE.md, plus: the label-vs-sibling placement of the new weight cell, the lg/xl handoff having no dead band, print geometry, and that food rows deliberately get no edit path.

- [ ] **Step 6: Merge only after Joe's OK**

Confirm CI green yourself with `gh run watch`, then `gh pr merge --squash --match-head-commit <sha>`. Branch protection does not wait for checks, so `--auto` protects nothing. Merge equals deploy; Joe's explicit approval is required.

---

## Plan self-review notes

- **Spec coverage:** design 3.1 -> Task 1; 3.2 -> Task 1; 3.3 -> Task 1; 3.4 -> Task 5; 3.5 -> Tasks 3 and 4; 3.6 -> Task 2; section 4 -> Task 6; section 6 tests -> distributed across Tasks 1-6 plus Task 7's browser pass.
- **One spec claim is narrowed here, deliberately:** section 3.5 says Pack rows show weight; this plan renders it at `lg+` only, and Task 3 Step 6 amends the spec rather than letting the two disagree.
- **Type consistency:** `onCreateNew: (data: AddItemData) => void` in Task 5 matches `AddItemData` from `use-quick-add-form`. `onEdit?: () => void` in Task 4 is a zero-arg thunk at every call site; the gear id is closed over by the caller, not passed through the menu. `weightUnit: WeightUnit` is required in both `PackFoodRowProps` and `SortableFoodRow`.
- **Selectors are flagged, not trusted.** Several tests assert accessible names and formatted weights this plan cannot verify without running. Every such step says to read the source of truth first - `formatItemWeight`, `QuickAddItemModal`'s button label, `MoveToLocationMenu`'s trigger name.
- **Task 2 depends on Task 1** and is meaningless before it; the others are independent and can be reordered.
