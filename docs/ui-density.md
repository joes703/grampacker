# UI density and design tokens

Source of truth for grampacker's row/table/panel visual grammar. Cited by
`src/components/flat-table-styles.ts`, `src/components/PillToggle.tsx`, and
`src/components/ToggleSwitch.tsx`.

The tokens live in `src/components/flat-table-styles.ts`. This document
explains the reasoning behind them and, more importantly, records **which
token owns which control** so the choice is a lookup rather than a judgement
call. The gear picker (`LibraryPanel`) is the reference implementation of the
row language.

Anything in this document marked NOT YET APPLIED describes a decision that has
been made but not finished rolling out. Do not read those rows as descriptions
of the current code.

## Why tokens at all

These are *base fragments*, not finished class strings. Call sites compose
their own layout-specific gap / padding / column / hover / selected classes
around the base. The constants own the cross-surface invariants - touch vs
pointer density, border and background language, control target sizing - so a
density change happens in one place instead of drifting across one-off
Tailwind strings.

Strings used exactly once anywhere in the codebase stay inline. Tokens exist
for repeated patterns, not for every `text-*` class.

## Two density tiers

Mobile is tuned for touch, desktop for pointer scanning. Pointer users
tolerate denser body type than touch readers, so **mobile sizes must stay
unchanged whenever desktop is tuned**.

| | Mobile (< lg) | Desktop (>= lg) |
|---|---|---|
| Row height | 44px (`min-h-11`) | 28px (`lg:min-h-7`) |
| Header height | 44px (`min-h-11`) | 32px (`lg:min-h-8`) |
| Row control target | 40px (`h-10 w-10`) | 28px (`lg:h-7 lg:w-7`) |
| Row padding | `px-2 py-2` | `lg:px-3 lg:py-0` |
| Header padding | `px-3 py-0` | `px-3 py-0` |
| Body text | 14px (`text-sm`) | 13px (`lg:text-[13px]`) |

The desktop header is deliberately 4px taller than the desktop row so the
section divider still reads as a distinct strip without bulking into a
card-like band.

13px (`lg:text-[13px]`) is a deliberate tier between Tailwind's `text-xs`
(12px) and `text-sm` (14px). It gives denser desktop scanning without the eye
strain of 12px. The arbitrary value is safe for Tailwind v4's JIT scanner
because the literal appears statically in the tokens file.

Desktop rows target a Lighterpack-style density where the eye scans columns
more than it reads sentences.

## Breakpoints

Two hooks in `src/lib/use-breakpoint.ts` mirror Tailwind exactly:

- `useIsBelowLg()` - true below 1024px, the negation of `lg:`
- `useIsMobile()` - true below 768px, the negation of `md:`

**Layout swaps that hand off to a touch presentation must use
`useIsBelowLg()`**, because every touch-sized token in this file compacts at
`lg`, not `md`. A surface that swaps at `md` renders its dense desktop
presentation across 768-1023px while its controls are still sized for touch,
or worse, sized for pointer on a touch device.

`FoodLibraryPage` currently swaps at `useIsMobile()` and is the known
exception. NOT YET APPLIED: it should move to `useIsBelowLg()` to match gear
and lists.

This is a recurring bug class in this repo. The mobile bottom bar is
`lg:hidden`, so header add-affordances must be gated `lg+` and not `md+` or
they double-render across 768-1023px.

## Control target taxonomy

The question "which token does this icon button use?" is decided by **where
the control lives and whether it can be touched**, not by what the icon is.

| Control | Token | Size |
|---|---|---|
| Chevron, kebab, drag handle, or action icon in a row or section header | `ROW_CONTROL_TARGET` | 40px touch / 28px pointer |
| Compact inline icon button in a surface that renders **only** at `lg+` | `RowIconButton` | 28x24, no touch box |
| Modal / drawer close button | `ROW_CONTROL_TARGET` | 40px touch / 28px pointer |
| Full-width disclosure button where the chevron is inline content | neither | the whole row is the hit area |
| Toolbar button, labelled options trigger, form stepper | neither | out of scope; bordered controls with their own padding |
| Compact panel header action (`PanelCard` `headerAction`) | neither | see below |

`RowIconButton` is the narrow case. It has no touch box, so it is only
correct where the containing surface provably cannot render below `lg`. If a
surface swaps at `md`, or renders at all widths, its row controls need
`ROW_CONTROL_TARGET` instead. Getting this wrong puts a 24px tap target on a
tablet.

NOT YET APPLIED: the taxonomy row above states the target rule, not the
current state. Several surfaces use `RowIconButton` while rendering at all
widths, so they present 28x24 controls to touch users:
`src/gear/CategorySection.tsx` (category drag, rename, and kebab controls),
`src/lists/FoodRow.tsx` (row kebab), and the food-module sites listed under
"Numbers" below. These are drift, not sanctioned exceptions - do not read
their existence as certifying the pattern.

Modal close buttons: six already use `ROW_CONTROL_TARGET`
(`QuickAddItemModal`, `ListImportPreviewDialog`, `FoodImportPreviewDialog`,
`GearImportPreviewDialog`, `CreateListFromSelectionDialog`, `GearItemDialog`)
and four are hand-written (`FoodItemDialog`, `MobileOptionsModal`,
`ListsPage`'s share modal, `ListSidebarDrawer`). The majority pattern wins.
NOT YET APPLIED: convert the remaining four and drop the "modal close buttons
are out of scope" line from `RowIconButton`'s header comment.

Panel header actions are genuinely a third case. `PanelCard`'s header is
`py-2` and documents `headerAction` as compact and baseline-aligned; a 40px
target would push that header to roughly 56px on mobile. `ROW_CONTROL_TARGET`
is documented for row and header chrome, not compact panel actions. The
current site (`ListDetailPage`'s edit-notes pencil) hand-rolls 24x24. This
needs its own token and its own decision; until it has one, do not force a
row token onto it.

## Toggle Taxonomy

Cited by `PillToggle.tsx` and `ToggleSwitch.tsx`. Four components can express
an on/off or either/or state; they are not interchangeable. Pick by **what the
state means**, not by where it sits.

| Component | Use for | Semantics |
|---|---|---|
| `PillToggle` | Page or list **mode** switches that change how the whole surface behaves | button; blue-50/blue-700 when active |
| `ToggleSwitch` | Binary **settings** and in-content view toggles | `role="switch"` |
| `RowIconButton` (`purpleToggle` / `orangeToggle`) | Per-row **flag markers** on an individual item (worn, consumable) | button with an `active` chip state |
| `UnitSegmentedControl` | Choosing **one of several** mutually exclusive options (metric/imperial) | real `sr-only` radio inputs behind visual labels |

The distinctions that matter:

- **Mode vs setting.** A mode changes what the surface *does* right now and is
  usually transient (Pack mode). A setting is a persisted preference that
  changes what the surface *shows* (Group Worn). Modes get `PillToggle`,
  settings get `ToggleSwitch`. `PillToggle`'s only consumer today is the Pack
  mode pill; its sizing is deliberately fixed, so reintroduce a `size` variant
  only when a second consumer actually needs one.
- **Two states vs several.** Anything with more than two options is a radio
  group, not a toggle. Use `UnitSegmentedControl`'s pattern - real radio
  inputs, visually relabelled - so keyboard arrow navigation works for free
  rather than being reimplemented with key handlers.
- **Row flags are not settings.** A worn or consumable marker belongs to one
  item, is one of many in a scanning column, and must obey the row control
  target rules above. It never uses `ToggleSwitch`, whose size and transition
  are tuned for panel chrome.

### Reserved space

A control hidden with `opacity-0` still occupies its box. Rows that
hover-reveal a drag handle therefore reserve its width on every row.

The rule that follows, and the reason the gear header and its rows now share
coordinates exactly:

- **The content column aligns per breakpoint, in the normal read state.** A
  section title and the item names beneath it start at the same x. Two desktop
  states are knowingly exempt, because each reshapes the row rather than the
  header: **select mode** swaps the row's 28px drag handle for a 16px
  checkbox, leaving the header title 12px right of the item names; **rename
  mode** puts the title in an input whose `px-1.5` sits its editable text 6px
  right of the item text. Both are improved by the current geometry but not
  zeroed. Do not "fix" either by re-tightening the header, which would break
  the normal state that the vast majority of viewing happens in.
- **A leading header control may reserve a row-control slot only when the rows
  reserve an equivalent slot at that breakpoint.** The collapse chevron
  qualifies: every row leads with a drag handle of the same width.
- **Section-only controls go after the title, before the trailing rail.** A
  category-level reorder grip has no per-row counterpart, so it must not lead.
  It also must not join the trailing cluster, because those
  Price/Purchased/Weight/kebab columns are width-matched to the row's own
  columns and anything inserted there shifts every label off-column. Placed
  after a `flex-1 min-w-0` title it takes its width from the flexible title
  region instead, costing only slightly earlier truncation of a long name.
- **The kebab stays last.** That invariant is what keeps the trailing rail
  aligned.
- **Do not buy alignment by taxing the rows.** Adding a stub to every data row
  to match a section-only control moves the problem rather than fixing it, and
  spends horizontal room on every row for a per-section affordance.
- **Disclosure stays an explicit button.** Never make the whole header strip
  clickable to solve a layout problem; that was deliberately removed because of
  mobile mistaps.

Justify this as **column alignment, not tree indentation**. A section header is
not a parent node, and "children indent less than their parent" is not itself
the defect. It matters here because this codebase treats these strips as column
headers and aligns their trailing labels to row values on purpose.

NOT YET APPLIED: on phones the list rows drop their drag handle entirely
(reorder moves to a long-press on the row) while the header keeps a 40px
chevron, so the title sits 46px right of the item names. By the rule above the
chevron should move trailing at that breakpoint. Ship it separately from the
desktop fix: relocating a touch affordance needs its own testing for mistaps,
trailing-edge crowding, and collapsed-state discoverability.

## Typography

### Headings and labels

- `FLAT_TABLE_HEADER_TITLE` - the one prominent section heading (category
  names). Preserves user capitalization; never uppercased.
- `FLAT_TABLE_HEADER_TITLE_MUTED` - same, de-emphasized.
- `FLAT_TABLE_EYEBROW` - every small uppercase micro-label: in-table column
  labels, summary stat labels, panel titles, disclosure toggles. One token so
  these do not drift apart in size, case, or color.
- `FLAT_TABLE_HEADER_COUNT` - the subdued tabular count beside a title.

### Body

- `FLAT_TABLE_BODY_TEXT` - body text on flat row surfaces.
- `FLAT_TABLE_BODY_TEXT_MUTED` - descriptions and secondary row copy. Rows
  that flip color reactively (e.g. the packed strikethrough) compose
  `FLAT_TABLE_BODY_TEXT` plus an inline color instead.
- `FLAT_TABLE_META_TEXT` - small qty/weight chips and tiny in-row labels.
- `COMPACT_PANEL_BODY_TEXT` - compact stat panel body (WeightTable cells).
- `MARKDOWN_COMPACT_BODY_TEXT` / `MARKDOWN_COMPACT_HEADING_TEXT` - notes.
- `PANEL_TOGGLE_LABEL` - the label beside a `ToggleSwitch` in a control panel.
  Canonical color is `text-gray-900`.
- `PANEL_EMPTY_TEXT` - italic placeholder for absent panel content.

### Numbers

Five different things in this app are "numeric" and they do not share a
treatment. Classify before reaching for a token:

| Kind | Meaning | Token | Mono? |
|---|---|---|---|
| **Value** | A measurement in a column: weight, cost, purchase date | `FLAT_TABLE_NUMERIC_TEXT` | yes |
| **Panel value** | An emphasis stat inside a compact panel | `COMPACT_PANEL_META_TEXT` | yes |
| **Quantity** | A count of items, in a Qty cell | `FLAT_TABLE_QUANTITY_TEXT` | no |
| **Count metadata** | "(5)" beside a section title | `FLAT_TABLE_HEADER_COUNT` | no |
| **Numeric prose** | "Updated 5 min ago", "3 of 8 packed" | none; inline | no |

`font-mono` is for **value displays only**. Never apply it to labels, item
names, category names, descriptions, notes, action buttons, or panel labels.
Mono glyphs render optically larger than the system sans face, which is why
value displays stay at `text-xs` on desktop instead of joining the 13px body
tier.

`tabular-nums` without `font-mono` is correct for quantities and counts: it
keeps digits from jittering as values change, without making the number read
as measurement data. Applying `tabular-nums` to text containing no digits is
a dead class.

Legitimate non-value `font-mono`: markdown `<code>` spans, the CSV header
`<pre>` in the import dialog, and the read-only share-URL input. These are
monospace for their own reasons, unrelated to the numeric rule.

NOT YET APPLIED: the `src/food/` module is **partially** converted. Newer
food code already consumes the shared tokens - `NutrientTotalCell` uses
`FLAT_TABLE_NUMERIC_TEXT`, `DayNutritionReview` uses the numeric, eyebrow, and
control-target tokens, and `FoodImportPreviewDialog` uses
`ROW_CONTROL_TARGET`. What remains unconverted is roughly twenty value cells
in `FoodLibraryPage`, `FoodPlanEditor`, `EntryDialog`, and the import-preview
value columns, which use `tabular-nums` without `font-mono`.

Check each site before converting; this is a partially completed migration,
not an untouched module. Food is not a separate visual family - the same files
that skipped the typography tokens also skipped the control-target ones, which
are unrelated to each other - so the remainder is drift rather than design.

Because several of those sites are currently `text-sm`, adopting
`FLAT_TABLE_NUMERIC_TEXT` verbatim would shrink them from 14px to 12px. The
decision is to preserve the size tier and add a size-preserving mono token
rather than collapse the hierarchy.

## Chrome

Compact detail tables (`WeightTable`), `PanelCard`, and the flat row tables
share one surface color, border color, divider color, and radius even where
their density and layout differ: `TABLE_RADIUS`, `TABLE_BORDER`,
`TABLE_SURFACE_BG`, `TABLE_HEADER_BG`, `TABLE_DIVIDER`,
`TABLE_STRONG_DIVIDER`.

`TABLE_DIVIDER_LINE` is the `divide-*` sibling of `TABLE_DIVIDER`, for row
groups separated by a container-level `divide-y` rather than per-row borders.
Same gray; Tailwind just needs the `divide-` form spelled out literally for
the JIT scanner.

`FLAT_TABLE_SURFACE` is a table/list shell, **not** a decorative card:
rounded corners plus a hairline border, no shadow. `overflow-hidden` clips
child row and header borders flush to the rounded edge - which is also why an
absolutely-positioned out-of-surface control gets clipped and cannot be used
for gutter drag handles.

Rows separated by a container-level `divide-y` must not use `FLAT_TABLE_ROW`
(the per-row `border-b` would double up), but should still consume
`MOBILE_ROW_HEIGHT` / `DESKTOP_ROW_HEIGHT` so they track density changes.

`INLINE_EDIT_FOCUS_RING` exists because inline-edit controls already use a
blue border to mean "editing", so keyboard focus needs a separate ring.

### Popover surface

`POPOVER_SURFACE` is the floating menu chrome: rounded card, hairline border,
white fill, soft drop shadow. Used by every kebab/portal menu and the options
popovers.

Deliberately not folded into `FLAT_TABLE_SURFACE` - popovers are floating and
shadowed with no overflow clipping. Both share border tone, radius, and fill
so the global chrome language stays unified; they vary on shadow and clipping
intentionally.

Call sites compose it with `fixed z-50 w-XX` plus a body padding (`py-1` for
menu-row popovers, `p-2`/`p-3` for embedded panels).

## Tailwind v4 scanning

Tailwind only scans for **whole class tokens**. Never build a class by
interpolating a fragment - `hover:${WORN_ICON_CLASS}` produces no CSS and
fails silently at build time. `RowIconButton`'s variant map duplicates its
color strings literally for exactly this reason. Composing a whole token into
a template string (`` `px-2 ${FLAT_TABLE_NUMERIC_TEXT}` ``) is safe, because
each class still appears literally in source.

## Intentional exceptions

- **`WeightTable`** is a deliberately tighter compact-summary table and does
  not consume the row density tokens.
- **`CategorySection`** (gear) previously used a tighter `gap-1 px-2` header
  with an `lg:pr-1` nudge on its column-label block. Both are gone: that
  variant existed to make room for an extra LEADING drag-handle column, and
  once the grip moved after the title the header could adopt the row's own
  `gap-1.5 px-3` outright. Sharing the row geometry is what makes the chevron,
  the title, and both ends of the trailing rail land on the row's coordinates
  with no compensation at all. Do not reintroduce a tighter variant here
  without re-measuring all four columns.
- **Picker rows** (`LibraryPanel`) and draft/footer rows use a flush `px-3`
  mobile pattern rather than `FLAT_TABLE_ROW_PADDING`.
- **The non-pack `ItemRow`** also keeps `px-3` on mobile rather than the
  canonical `px-2` ramp: the mobile read body carries fewer columns than pack
  mode, so the wider uniform inset reads better. Do not normalize this to
  `FLAT_TABLE_ROW_PADDING` in a density cleanup.
- **Modal titles, primary CTAs, and auth pages** are not row/table/panel
  chrome and are out of scope for these tokens entirely.
