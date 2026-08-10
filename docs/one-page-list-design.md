# One page for a list: design

Status: DRAFT - awaiting review
Date: 2026-08-09
Relates to: `src/lists/ListDetailPage.tsx`, `src/lists/LibraryPanel.tsx`,
`src/lists/CategoryGroup.tsx`, `src/lists/list-detail-mode.ts`.
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

Smaller than it sounds. The three views already render from one component
(`ListDetailPage`) with the mode derived from the URL, so "stop changing
pages" is mostly already true. Four edits carry it:

### 3.1 The picker renders in Pack

`ListDetailPage.tsx:1923` gates the left `<aside>` on `mode === 'edit'`.
It becomes `mode === 'edit' || mode === 'pack'`. Food keeps its own left rail
and is still excluded.

### 3.2 Pack stops narrowing

`ListDetailPage.tsx:1949` centres Pack at `max-w-3xl` to compensate for the
missing sidebar. With the sidebar back, that compensation is wrong and the
class goes.

### 3.3 The picker gets width

The aside is `w-80` (320px). It becomes `w-80` at `lg` and `w-96` (384px) at
`xl`, so the picker's rows have room without squeezing the list on the
narrowest desktop.

The lists switcher (`DesktopListsPanel`) is hidden in Pack. Nobody switches
lists mid-pack, and its `max-h-72` is height the picker needs. Reversible;
say so if it feels wrong.

### 3.4 Creating a new item works from either view

This is the only net-new control. A **"+ New item"** action at the top of
`LibraryPanel` opens `QuickAddItemModal` - the existing modal, not the inline
`AddItemRow`, which is a full-width table row and cannot fit a 320px sidebar -
and calls the existing `quickAddListItem` mutation, which creates the
`gear_item` and the `list_item` in one atomic server call. Both already share
`useQuickAddForm`, so no new form logic is written.

**Why the picker and not the section footer.** In Category view the sections
are gear categories, so "+ Add new item" in a section footer means "create it
in this category" - which is what it does today. In Pack view the sections are
*bags*. Wiring the same footer there would hand a packing-location id to a
mutation whose parameter is a category id. Putting the control in the picker
sidesteps that entirely: it is the one surface that means the same thing in
both arrangements.

A new item created this way lands Uncategorized in Category view and
Unassigned in Pack view - the existing defaults for anything new. Moving it
is one drag or one Move-to.

### 3.5 The redundant button goes

`ListDetailPage.tsx:2055` renders a desktop-only "Add gear" button in Pack
that opens the picker in a drawer. With the picker permanently on screen at
`lg+` it is a second control for a visible surface, so it is removed. The
mobile drawer and the mobile action bar's Add are untouched - below `lg`
there is no room for an aside and the drawer remains the only path.

## 4. Naming

`ListViewNav` currently reads **List | Food | Pack**. "List" becomes
**Category**, so the label says what the arrangement is rather than what the
page is. URLs do not change: `/lists/:id` stays the Category view, so every
bookmark, stored last-list path and legacy `/organize` redirect keeps working
and no persisted-path migration is needed. Only `LIST_VIEW_LABELS` and the
document title change.

Reversible. If "Category" reads oddly next to "Pack", say so.

## 5. Risks

**Pack content gets narrower at exactly 1024px.** Today Pack is 768px
centred. With a 320px aside and gaps it is roughly 660px. Pack rows are
dense - grip, two checkboxes, name, description, two icon slots, quantity,
menu - and the description column is already `hidden lg:block`. This must be
checked at 1024px before merge, not assumed. If it does not fit, the aside
collapses below `xl` rather than the design reverting.

**The aside is sticky at `calc(100vh - 2rem)`.** It was written for the
Category view's length. Pack with many bags is longer; verify the picker
still scrolls internally rather than the column growing.

**Print.** The aside is `print:hidden` and `max-w-3xl` was screen-only, so
the printed checklist should be unaffected. Assert it rather than assume it.

**`ListDetailPage.tsx` is 2,694 lines.** This change adds no significant
size, so no extraction is bundled here - AGENTS.md forbids folding a refactor
into a feature PR. It is worth its own PR later.

## 6. Tests

- The aside renders in Pack at `lg+` and does not render in Food.
- The desktop "Add gear" button is gone from Pack; the mobile drawer still
  opens from the action bar below `lg`.
- "+ New item" in the picker creates gear plus list item in one call, from
  both Category and Pack, and the row appears Uncategorized/Unassigned.
- Creating from Pack does not send a packing-location id as a category id.
- Pack still renders its rows, checkboxes, drag and Move-to menu unchanged.
- Print snapshot of Pack is unchanged.
- Existing `ListDetailPage.pack.test.tsx` and `ListDetailPage.pack-food.test.tsx`
  keep passing untouched.

No server changes, no migrations, no `docs/authz-matrix.md` rows. The one
mutation involved (`quickAddListItem`) already exists and is already
authorized and tested.

## 7. Deliberately not in this piece

Named so they are not assumed to be included:

- **Editing gear from a Pack row.** Pack rows today show no weight and carry
  no editor (`ItemRow.tsx:183-299`). Joe asked for editing in both views. It
  is excluded here because it belongs with unifying the two add screens and
  the two edit screens into one - a separate piece of work, and the larger
  half of Joe's complaint.
- **Selecting several rows and moving them to a bag.** Wanted, and gear
  already has the machinery (`use-gear-bulk-actions.ts`) that lists have
  never had.
- **Food items as rows in Category view** instead of the single summary line.
  Small once this lands.

Separately, and not part of any of the above: the public share view carries no
food at all (`server/routes/shares.ts` never selects it), while the owner's
totals run through `withFoodWeight`. A shared list therefore reads lighter
than the same list reads to its owner. That is a real inconsistency and needs
its own small fix.
