# Food view redesign: design

Status: DRAFT - awaiting review
Date: 2026-08-06
Relates to: the 0017 food estimate (`shared/food.ts`, `server/repos/food.ts`,
`src/lists/FoodSection.tsx`). `docs/food-planning-design.md` remains superseded
history; nothing from the deleted planner returns here.
Sequencing: ships BEFORE remediation Phase 8 (P1.6 food revision CAS,
`docs/review-remediation-plan.md`), so the 409 refetch-and-reconfirm client
work lands once, in the new components, instead of twice.

## 1. What this is, and is not

A **UI-only** redesign of the food estimate. The data model, the API, the
caps, the three-state slot semantics, and every mutation contract are
unchanged. Zero server changes; zero migrations; no authz-matrix rows.

The problem, from Joe's review of the running app: food planning is wedged
inline into the gear list between other categories; the add form is a row of
unlabeled boxes; weights live in a separate "Carrying" list disconnected from
the day grid; "Not needed / Need it" is unexplained jargon; the whole section
is visually flat text links and cramped one-letter checkboxes; and on desktop
the narrow mobile layout just stretches.

Non-goals, stated so they are not re-litigated mid-build: no food library, no
nutrition, no reusable plans (all deliberately deleted in 0016), no food in
Pack mode, no share changes, no schema or API changes.

## 2. Route and navigation

Food becomes a **third list view**, peer to List and Pack, using the existing
mode machinery:

- `ListDetailMode` gains `'food'`; `deriveListMode` maps `/lists/:id/food` to
  it; `persistedListPath` and the stored-path sync handle it like Pack.
- `AuthenticatedApp` adds `<Route path="lists/:id/food">` -> `ListDetailPage`.
  The old top-level `food/*` -> `/lists` redirect (the deleted planner's home)
  is untouched; the paths do not collide.
- `ListViewNav` renders **List | Food | Pack**. Same segmented control, same
  aria-current semantics, one more entry.
- Document title follows the existing `listDocumentTitle` pattern.

`ListDetailPage` renders a new `FoodView` component for the mode. The food
chunk (state, mutations wiring, `FoodSection`) moves out of `ListDetailPage`
into it; `FoodSection.tsx` is replaced, not patched (moved intact in PR 1,
replaced in PR 2 - section 6). New components live flat
in `src/lists/` per convention: `FoodView.tsx`, `FoodDaySection.tsx`,
`AddFoodForm.tsx` (extracted), `FoodSlotPicker.tsx` (extracted).

## 3. What remains on the List view

One derived summary row where `FoodSection` sits today, after the category
groups: **`Food · 3 days · 2.4 kg`**, linking to the Food view. When nothing
is planned it reads **`Food · none yet`** and still links. This exists because
food weight keeps counting toward the totals shown on the List view
(`weight-breakdown.ts` composition is unchanged), and a weight contributor
with no visible source is a trap. The List view therefore keeps its existing
food query; nothing about data fetching changes.

The "don't double-count a Food bag gear row" note moves to the Food view.

## 4. The Food view

Stacked full-width sections, in order: header, day sections, add-food card,
Carrying card. (Decided 2026-08-06 over a grid-with-right-rail composition
and over meals-as-columns; Joe picked the flat-table-shaped options.)

Revised 2026-08-07: at `lg` and up the add-food card + Carrying card move
into a sticky ~360px LEFT rail (tools left of the document, matching the
edit-mode aside) and the day sections keep the flexible width, with the
whole view capped at `max-w-6xl`. Below `lg` that panel stacks ABOVE the day
sections so the add action is reachable without scrolling a long trip. Joe
found the shipped full-width stack wasteful on desktop and picked the rail
composition originally proposed, then chose left-of-days and panel-on-top
over the first-cut right rail / panel-below. Known trade-off, accepted: a
long Carrying list pushes the day plan down on mobile; splitting the panel
(add above, Carrying below days) would break the desktop sticky grouping or
need visual-order CSS that diverges from DOM order.

### 4.1 Header

The existing trip-length control, restyled into the view header: "Food for
[N] days" with the derived meal counts eyebrow. All current semantics are
kept verbatim: the empty-field-is-not-zero guard, the day cap, the
lose-work confirm on shrinking, the refetch-before-apply, and the KNOWN GAP
comment (which Phase 8 removes). One quiet explainer line: *"Skip meals
you'll eat in town or on the road."*

### 4.2 Day sections

One section per day, flat-table styling (`FLAT_TABLE_*` vocabulary), eyebrow
"Day N". One row per meal; within a filled meal, one line per food showing
**name · ×qty · weight** (weight via `ItemWeightValue`, active unit), aligned
in columns on desktop, weight right-aligned on mobile. A meal with 2+ foods
gets a meal subtotal; every day gets a day-total row.

Row states:

- **Filled**: the food lines, per above. Display-only in the grid; item
  actions live in Carrying.
- **Empty (needed)**: the omission signal stays deliberate but gets a real
  treatment - a subdued amber "Nothing planned" badge plus an inline
  **+ Add** affordance that opens the add-food form with that slot
  preselected (scrolls the form into view).
- **Skipped**: the button pair becomes **Skip / Restore** (replacing "Not
  needed / Need it"); a skipped row reads "Skipped", gray, meal name
  struck through. The existing confirm when skipping a filled slot stays
  word-for-word in intent (its copy updates from "not needed" to "skip").

The three states remain visually distinguishable at a glance; that
distinction is the point of the grid and survives the restyle.

### 4.3 Add-food card

A real card with a proper primary **Add food** button (no more text link).
Desktop lays the fields in one row; mobile wraps.

- **Name** - labeled.
- **Weight** - the app's `WeightInput` (labeled, unit-aware g/oz with the
  unit selector), exactly as gear entry uses it. The bare
  grams-only box dies.
- **Qty** - labeled "Qty"; the units-carried semantics and the
  quantity-is-not-slot-count rule are unchanged.
- **Slot picker** - "Every breakfast / lunch / dinner" chips stay; the
  per-day rows replace one-letter checkboxes with three full-name toggle
  chips (Breakfast / Lunch / Dinner), touch-friendly sizing per the app's
  `touchSafe` conventions.
- **Live preview** - a line that assembles as you type:
  *"Adding: Oatmeal packet · 80 g × 2 · Day 2 breakfast, Day 3 breakfast"*
  (weight in the active unit). Slot naming collapses: an active whole-meal
  chip reads "every breakfast"; otherwise up to three slots are named, then
  "+ n more".

Kept: client-side validation mirroring `shared/food.ts` bounds; the form
closes only on success so a cap rejection never eats the typed input.

### 4.4 Carrying card

One card, one list - the current duplicate "Unscheduled" section merges in:
an unscheduled item shows an amber **Unscheduled** badge on its row instead
of appearing twice. Columns: name | schedule summary ("3 meals" / "Any
time") | ×qty | total weight | Reschedule | delete. A totals row closes the
card: **"12 items · 2.4 kg"**. Reschedule opens the same slot picker inline
under the row, as today. The double-count warning line lives here.

## 5. Behavior contract (unchanged, testable)

Everything the current tests pin stays true: mutation wiring, busy states,
confirms (shrink-trip, skip-filled-slot), cap error surfacing, success-close
on add, slot-picker filtering to needed slots, unschedule-vs-leave-alone
distinction in updates. `FoodSection.test.tsx` and
`ListDetailPage.food.test.tsx` port to the new components; assertions about
behavior survive, assertions about markup update.

New tests: Food appears in `ListViewNav` with correct aria-current; the
route derives the mode; the List-view summary row (value, link, none-yet
state); the live preview line content; per-slot + Add preselects the slot;
the Unscheduled badge; Skip/Restore labels and the skip-filled confirm.

## 6. Slicing

Two PRs:

1. **Move**: the `'food'` mode, route, nav entry, `FoodView` holding the
   existing `FoodSection` body essentially as-is, the List-view summary row,
   test ports. Structural, near-zero visual change, easy review.
2. **Redesign**: the new day sections, add-food card, Carrying merge,
   Skip/Restore language, polish. Visual change on an already-moved
   surface.

Phase 8 (releases 8A/8B) follows PR 2.

## 7. Decisions

- **D1 - UI-only; the 0017 model stays.** Every reviewed complaint is
  presentational; no schema or API change is warranted.
- **D2 - Food is a peer list view**, not a separate page or an inline
  collapse. Matches the Pack-mode precedent exactly.
- **D3 - Wide day sections, not meals-as-columns.** Flat-table idiom,
  weight/qty inline per food (chosen 2026-08-06).
- **D4 - Stacked full-width composition**, no right rail, no add dialog
  (chosen 2026-08-06). REVISED 2026-08-07: sticky left rail on desktop after
  all, and the add/Carrying panel stacks above the days below `lg` (see
  section 4).
- **D5 - "Skip / Restore" replaces "Not needed / Need it".** The three-state
  model is load-bearing and stays; only the language and prominence change.
- **D6 - Unscheduled merges into Carrying as a badge.** Two lists showing
  the same rows was the confusion, not the state itself.
- **D7 - Redesign ships before remediation Phase 8**, so the CAS client UX
  is built once, in the new components.
