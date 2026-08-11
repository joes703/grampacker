# One page for a list: design

Status: SHIPPED 2026-08-10 (PR #200). DATED RECORD - not binding; the code is
the current statement of this design.
Date: 2026-08-09
Relates to: `src/lists/ListDetailPage.tsx`, `src/lists/LibraryPanel.tsx`,
`src/lists/CategoryGroup.tsx`, `src/lists/ItemRow.tsx`,
`src/lists/list-detail-mode.ts`.
Supersedes one decision in `docs/organize-pack-design.md`: desktop Pack no
longer hides the gear picker.

## 1. Where this came from

Joe packed for a real trip and reported four problems:

1. Grams cannot be edited inline on the gear page.
2. Packing takes three tabs - pick things, adjust weights, add things,
   organize into containers.
3. Adding one forgotten item meant Gear view -> List view picker -> Pack view
   to place it.
4. There is no way to select several rows and move them to a container at once.

The underlying cause is that capabilities landed wherever the PR that built
them happened to be, not where the job needs them:

| | Gear page | Category view | Pack view |
| --- | --- | --- | --- |
| Add an existing item | - | picker | picker (drawer) |
| Create a new item | dialog | quick add | **no** |
| Edit name/description/weight inline | **no** | yes | **no** |
| See an item's weight | yes | yes | **no** |
| Assign to a bag | - | - | yes |
| Select many rows | yes | **no** | **no** |

## 2. The agreed shape

One page per list. The gear picker sits beside the list and stays put. What
changes between views is how the rows are arranged, not which page you are on.

- **Category** - today's List view. Grouped by gear category. The
  LighterPack-equivalent arrangement.
- **Pack** - the same rows grouped into bags, with the packed and ready
  checkboxes, drag, click-to-place and the Move-to menu. Organizing stays
  always-on inside Pack; that merge already happened and has held
  (`list-detail-mode.ts:4`).
- **Food** stays a separate nav destination. Days, meals and slots are not a
  way of grouping gear, so food cannot be a third arrangement of the same
  rows. Joe confirmed he uses the day/meal planner, so it stays.

`/gear` also stays. It owns cost, purchase date, retired gear and bulk
category moves - none of which belong beside a trip.

This design covers **only** the page-shape change. Three follow-on pieces are
named in section 7 and deliberately excluded.

## 3. What actually changes

The three views already render from one component (`ListDetailPage`) with the
mode derived from the URL, so "stop changing pages" is mostly already true.

### 3.1 The picker renders in Pack - at `xl`, not `lg`

`ListDetailPage.tsx:1923` gates the left `<aside>` on `mode === 'edit'`.
It becomes `mode === 'edit' || mode === 'pack'`.

**Pack's aside appears at `xl` (1280px), not `lg`.** Category's stays at `lg`,
unchanged. The measurement, from the Codex review: at exactly 1024px the
shell's 32px padding leaves 992px, minus a 320px aside and a 16px gap leaves
**656px** for the document. After row padding, grip, two checkboxes, two icon
slots, quantity, the packing menu, gaps and the new 96px weight cell, the
name+description label drops from ~422px to ~316px - about **113px for the
name** under its 2:3 split. Nothing overflows, because the flexible cells are
`min-w-0 truncate`; instead names and descriptions silently disappear. Nested
containers cost roughly another 25px per depth
(`PackLocationSection.tsx:59`).

Category rows are far less dense and are fine at `lg`, so only Pack moves.

Food keeps its own left rail and is still excluded from this aside.

### 3.2 Pack stops narrowing on screen, keeps it in print

`ListDetailPage.tsx:1949` centres Pack at `max-w-3xl`. That compensated for
the missing sidebar, so on screen it goes.

`max-w-3xl` is an **unprefixed** utility, so it applies to print as well.
Dropping it outright would widen the printed checklist on any print
configuration with a content area over 768px. The constraint is therefore
preserved for print only (`print:max-w-3xl print:mx-auto`).

### 3.3 The picker gets width

The aside is `w-80` (320px) and becomes `w-96` (384px) at `xl`. Since Pack's
aside only exists at `xl`, Pack always sees the wider one.

`DesktopListsPanel` is hidden in Pack. Nobody switches lists mid-pack, and its
`max-h-72` is height the picker needs. Reversible; say so if it feels wrong.

### 3.4 Creating a new item works from either view

A **"+ New item"** action at the top of `LibraryPanel` opens
`QuickAddItemModal` - the modal, not the inline `AddItemRow`, which is a
full-width table row and cannot fit a 384px sidebar - and calls the existing
`quickAddListItem` mutation, which creates the `gear_item` and the `list_item`
in one atomic server call. Both already share `useQuickAddForm`, so no new
form logic is written.

**Why the picker rather than the section footer.** Corrected after review: the
original claim that a footer add in Pack would send a bag id to a category-id
parameter was **wrong**. Location sections pass their id as `regionKey`, not
`categoryId` (`PackLocationSection.tsx:117`), Unassigned passes
`categoryId={null}` explicitly (`ListDetailPage.tsx:2147`), and
`sharedGroupProps` carries neither `categoryId` nor `onAddItem`
(`ListDetailPage.tsx:1577`). A footer add inside a bag would submit `null`,
not a location id.

The real reason stands and is weaker than claimed: a footer add inside a bag
has **no meaningful category to offer**, so it would silently create
everything Uncategorized while appearing to add "to this bag". The picker is
the one surface that means the same thing in both arrangements. This only
becomes a correctness bug if an implementation repurposes `regionKey` as
`categoryId` - which the tests below pin.

**Where a new item lands** (the original claim here was also wrong):

- Category view: **Uncategorized**.
- Pack with no bags yet: Pack falls back to category grouping
  (`packing-grouping.ts:14`), so also **Uncategorized**.
- Pack with bags: **Unassigned**.
- Worn items: the **Worn** section in either arrangement.

**Failure behavior, decided explicitly.** The picker mounts outside Pack's
detail loading/error gate (`ListDetailPage.tsx:1962`), so without a gate the
control could write successfully while the document says it could not load.
The user would have no way to see the result. **"+ New item" is therefore
disabled whenever the detail data is pending or errored**, with the reason
stated. This is not the `membershipUnknown` case - quick add computes nothing
from the cached collection (`use-list-item-actions.ts:190`) - it is about the
user being able to confirm what happened.

**The modal closes before the mutation settles.** `QuickAddItemModal` has no
pending or inline-error API, and a toast raised while a `<dialog>` is open
renders behind it (AGENTS.md). Closing first matches what the inline flow
effectively does and keeps the existing error toast visible.

`LibraryPanel`'s empty-state copy ("Add it on the Gear page",
`LibraryPanel.tsx:118`) is updated, since that is no longer the only way.

### 3.5 Pack rows show weight and can be edited

Pack rows today render grip, ready checkbox, packed checkbox, status badge,
name, description, worn/consumable icons, quantity and the Move-to menu
(`ItemRow.tsx:183-299`). No weight, and no way to change anything.

That makes Pack incoherent on its own: "adjust weight of things" was one of
the four jobs that forced the three-tab shuffle.

- **A weight cell**, matching Category's 96px column: `ItemWeightValue`
  wrapped in `FLAT_TABLE_NUMERIC_TEXT` per `docs/ui-density.md`. It sits as a
  **sibling after** the wrapping `<label>`, exactly where the existing menu
  sits - inside the label it would become part of the toggle-Packed gesture
  (`ItemRow.tsx:230`). It is `print:hidden`, so the printed checklist keeps
  its current row content (see 3.2 and section 6).

  **`lg+` only** (narrowed during implementation, 2026-08-09). The mobile pack
  row already drops its description for room; a 96px cell at 375px would crush
  the name, and mobile Pack is the densest surface in the app. Mobile Pack
  keeps the layout it has, and the weight stays reachable there through the
  Food and Category views.
- **The same weight cell on food rows** (`SortableFoodRow.tsx:68`, which
  already carries `weightGrams`). Without it, a bag holding both gear and food
  renders misaligned columns.
- **"Edit item" in the row menu.** `onEditGearItem` exists in
  `sharedGroupProps` (`ListDetailPage.tsx:1619`) and `CategoryGroup` turns it
  into a per-row callback (`CategoryGroup.tsx:420`), but **Pack's `ItemRow`
  branch never consumes it** - Pack's menu is built independently by
  `renderPackRowAction` (`ListDetailPage.tsx:1664`). So `MoveToLocationMenu`
  takes an explicit new edit callback.

**Three Pack row shapes, not one.** "Pack rows can be edited" is only true if
all three get there:

1. Ordinary rows, via `MoveToLocationMenu`.
2. **Worn rows**, which have a standalone Remove button and no packing menu
   (`ListDetailPage.tsx:1759`).
3. **Container items**, which render in section headers with their own
   separately constructed `MoveToLocationMenu` (`ListDetailPage.tsx:1794`).

**Inline editing in Pack is not part of this.** Typing into a Pack row
competes with the wrapping label. Pack gets the dialog; Category keeps its
inline fields; merging them is the next piece.

### 3.6 The "Add gear" button stays, retargeted

`ListDetailPage.tsx:2055` renders a desktop-only "Add gear" button in Pack
opening the picker in a drawer, gated on `!isBelowLg` (1024px and up).

It cannot simply be removed. With Pack's aside starting at `xl`, removing it
would strand **1024-1279px** with no way to reach the picker: `useIsBelowLg`
is false there, so the mobile action bar's Add is hidden too
(`use-breakpoint.ts:7`, `MobileListActionBar.tsx:48`).

So the button becomes `hidden lg:flex xl:hidden` - a CSS-only handoff, no new
JS breakpoint. Below `lg` the action bar carries Add; from `lg` to `xl` this
button does; at `xl` and up the aside is on screen and the button is gone.

## 4. Naming

`ListViewNav` reads **List | Food | Pack**. "List" becomes **Category**.

URLs do not change: `/lists/:id` stays the Category view, so bookmarks, the
stored last-list path and the legacy `/organize` redirect all keep working and
no persisted-path migration is needed.

Two independent places hold the label and both must change:
`LIST_VIEW_LABELS` (`list-detail-mode.ts:17`, which also feeds the document
title) and the `VIEWS` array in `ListViewNav.tsx:5`.

Reversible. If "Category" reads oddly next to "Pack", say so.

## 5. Risks

**The `xl` threshold is a real cost.** Between 1024 and 1279px Pack looks
exactly as it does today - no picker, drawer button instead. That window is a
common laptop width. The alternative was silently truncating item names to
~113px, which is worse. If it turns out to matter, the fix is a denser Pack
row, not a narrower breakpoint.

**Drag is expected to be unaffected, not assumed to be.** Codex found no
structural defect: the picker has bounded flex height with its own
`overflow-y-auto` (`LibraryPanel.tsx:91`), and `DndContext`/`DragOverlay` live
wholly in the sibling document column (`ListDetailPage.tsx:2120`), so the
aside's scroller is not an ancestor of any dragged row. Still verify
auto-scroll in a real browser.

**`ListDetailPage.tsx` is 2,694 lines.** This adds little, so no extraction is
bundled - AGENTS.md forbids folding a refactor into a feature PR. Worth its
own PR later.

## 6. Tests

- The aside renders in Pack at `xl`, not at `lg`; Category's still renders at
  `lg`; neither renders in Food.
- The "Add gear" button is present from `lg` to `xl` and absent at `xl`+; the
  mobile action bar still carries Add below `lg`. No width has zero paths to
  the picker.
- "+ New item" creates gear plus list item in one call from both views, and
  the row lands Uncategorized / Unassigned / Worn per 3.4.
- Creating from Pack passes a category id or `null` - never a
  `regionKey`/location id.
- "+ New item" is disabled while detail data is pending or errored.
- The modal closes before the mutation settles, and a failure raises a visible
  toast rather than one trapped behind the dialog.
- Pack rows show weight matching Category at `lg+` and nothing new below it;
  food rows in the same bag carry the identical cell.
- "Edit item" opens the dialog from all three Pack shapes: ordinary row, worn
  row, container item.
- Clicking a Pack row's name still toggles Packed - the weight cell and menu
  entry do not steal the gesture.
- Print: Pack keeps its 768px width on paper and the weight cell does not
  appear, so the printed checklist is unchanged.
- Existing `ListDetailPage.pack.test.tsx` and `ListDetailPage.pack-food.test.tsx`
  keep passing.

No server changes, no migrations, no `docs/authz-matrix.md` rows. The only
mutation involved (`quickAddListItem`) already exists and is already
authorized and tested. Session-scoped ownership, the locked public-share
projection, D1 parameter caps and CSRF/auth layering are untouched - this is
client-side composition over queries and mutations that already exist.

## 7. Deliberately not in this piece

- **One editor everywhere.** Pack reaches the edit dialog (3.5) but Category
  still has inline fields and `/gear` still has its own dialog, and adding has
  two implementations too (`QuickAddItemModal` versus `GearItemDialog`).
  Collapsing those into one editor is the next piece, and it is what finally
  puts inline grams on the gear page.
- **Selecting several rows and moving them to a bag.** Wanted, and gear
  already has the machinery (`use-gear-bulk-actions.ts`) that lists never had.
- **Food items as rows in Category view** instead of the single summary line.
  Small once this lands.

Separately, and not part of any of the above: the public share view carried no
food at all while the owner's totals counted it, so a shared list read lighter
than the same list read to its owner. FIXED 2026-08-11 - the share now
publishes `food.weightGrams` (an aggregate, never rows) and both surfaces
compute through one required compositor.
