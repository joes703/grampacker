# UI density and design tokens

**BINDING, maintained against the code.** Source of truth for grampacker's
row/table/panel visual grammar. Cited by
`src/components/flat-table-styles.ts` and `src/components/ToggleSwitch.tsx`.

The tokens live in `src/components/flat-table-styles.ts`. This document gives
the reason for each one and records **which token owns which control**, so
the choice is a lookup, not a judgment call. The gear picker (`LibraryPanel`)
is the reference implementation of the row language.

## How to use this

**Consult it; do not try to satisfy it.** Most of this file is an index of
what exists and why. Read it before you build a surface, to find out whether
what you need already has a name. It is not a checklist, and a change is not
wrong because it does not appear here.

Three ideas carry the rest:

1. **Compose the vocabulary; do not re-type it.** The tokens own the rules
   shared across surfaces - density, border and background, control sizing -
   so a change happens in one place. They are base fragments; call sites
   still add their own layout, gap and hover classes.
2. **Tokens are for repeats.** A string used once stays inline. Hoist it
   when a second surface needs it, not before.
3. **Density has three tiers, and they move independently.** Mobile is tuned
   for touch, desktop for pointer scanning, print for paper. Changing one
   must not move the others.

## Two screen density tiers

Mobile is tuned for touch, desktop for pointer scanning. Pointer users can
read denser body text than touch users, so **mobile sizes stay unchanged
when desktop is tuned**.

| | Mobile (< lg) | Desktop (>= lg) |
|---|---|---|
| Row height | 44px (`min-h-11`) | 28px (`lg:min-h-7`) |
| Header height | 44px (`min-h-11`) | 32px (`lg:min-h-8`) |
| Row control target | 40px (`h-10 w-10`) | 28x24px (`lg:h-7 lg:w-6`) |
| Leading control target | 40px (`h-10 w-10`) | 28x20px (`lg:h-7 lg:w-5`) |
| Row padding | `px-2 py-2` | `lg:px-3 lg:py-0` |
| Header padding | `px-3 py-0` | `px-3 py-0` |
| Body text | 14px (`text-sm`) | 13px (`lg:text-[13px]`) |

The desktop header is 4px taller than the desktop row, so the section
divider reads as its own strip without looking like a card.

Desktop rows aim for a LighterPack-style density, where the eye scans
columns more than it reads sentences. 13px (`lg:text-[13px]`) sits between
Tailwind's `text-xs` (12px) and `text-sm` (14px): denser than 14px, easier to
read than 12px. The arbitrary value is safe for Tailwind's scanner because
the literal is in the tokens file.

### Control columns

Neither desktop control column is square.

The TRAILING column (kebabs, action icons) is 24px wide. That is the 24px
pointer-target floor of WCAG 2.2 SC 2.5.8. `rounded` clips the corners, so
the box still relies on the spec's spacing exception; at the floor, less of
that argument depends on gaps that move when the layout changes. A wider box
would leave a 14px glyph loose inside it. `RowIconButton`'s compact width
must stay equal to this width so header and row controls share a column.

The LEADING column (drag grip, collapse chevron) is 20px wide, because of the
glyph. `GripVertical` draws two thin columns of dots about 6px wide, so a
24px or 28px box leaves empty space on both sides and every draggable row
starts with a wide empty gutter. Only the width is reduced: 28px is the
desktop row height, so the height costs nothing. Mobile keeps the full 40px
square, which a thumb needs.

A section header's collapse chevron and a row's drag grip share that column
and must stay the same width, or the item names stop lining up with the
section title above them (see "Reserved space"). They therefore use one
token, `ROW_LEADING_CONTROL_TARGET`, so the width cannot get out of sync. The
chevron glyph is 14px so it fits inside the narrower box.

## The print tier

A third tier, for paper. It moves neither screen tier, and neither screen tier
moves it.

**Why it exists.** `lg:` is `min-width: 64rem` (1024px at a 16px font), and a
browser checks print media queries against the **page box**, not the screen.
US Letter and A4 portrait are both about 816 CSS px wide, so `lg:` does not
match there, and without this tier the sheet would print the 44px touch tier.
Wide paper, or landscape, can be wider than 1024px and match `lg:` again. The
print tier applies either way, so it is defined against the base tier, not
against `lg:`.

| | Print |
|---|---|
| Row / header height | none (`print:min-h-0`) |
| Row / header padding | `print:px-1 print:py-0` |
| Body text | 10px (`print:text-[10px]`) |
| Column labels (`FLAT_TABLE_EYEBROW`) | 8px (`print:text-[8px]`) |
| Row gap | `print:gap-1` |
| Interactive controls | not rendered (`print:hidden`) |
| Pack layout | two columns of sections (`print:columns-2`), full printable width |

Paper needs no touch targets and shows far finer detail than a screen, so
this tier is denser than either screen tier.

**Two columns.** A checklist row is two checkboxes, a name and a quantity,
so one column would leave half of every page empty. On paper, Pack's section
wrapper (`PackDocument`) becomes a two-column block, and the document column
drops its screen width limit (`print:max-w-none`). The fragmentation hints
below apply to column breaks as well as page breaks.

**Names wrap instead of truncating.** On a checklist, a name cut off with an
ellipsis is missing information, and paper has no scroll or resize to show
the rest. `PRINT_UNTRUNCATE` undoes `truncate` on paper, and rows have no
minimum height because they may wrap. It is composed on:

- Pack gear and food row names (`PackRowFrame`);
- Pack section and container titles (`PackSection`);
- section titles in `CategoryTable` (List view and the public share).

Other row names (for example item names in List view) still truncate on
paper.

The token also sets `overflow-wrap: anywhere`. Normal wrapping breaks only at
spaces, and a gear name can be 256 characters with none. Some elements that
never truncate set only `[overflow-wrap:anywhere]` directly:
`PrintListHeader`'s title, the print-only section name that replaces the
rename input in `SortablePackSection`, and food plan row names
(`FoodPlanRow` in `FoodDaySection`).

**Hiding the controls is what makes a row shorter.** A minimum height does
not limit CONTENT height, so a visible 40px drag grip keeps a row at 40px no
matter how low `print:min-h-0` goes. So `RowIconButton` has `print:hidden`
on its own base classes (every grip, kebab and inline edit or delete button
is a `RowIconButton`), and so does `POPOVER_SURFACE`: `KebabMenu` portals
every menu into `document.body`, where no ancestor of the trigger can hide
it.

**A hidden control that also shows data needs a print-only copy.** In an
editable row, the worn/consumable toggles' active state is what says the
item is worn. So `ItemRow` renders print-only static icons in the same
column as the hidden toggles. Check for this whenever you hide something
that also works as an indicator.

**Fragmentation is partial on purpose.** `FLAT_TABLE_ROW` has
`print:break-inside-avoid` and `FLAT_TABLE_HEADER` has
`print:break-after-avoid`: they ask the browser not to split a row across a
page or column, and not to leave a heading alone at the bottom of one. These
are hints, not guarantees (a browser may ignore them to make progress), and
they have not been checked against real pagination. Whole SECTIONS are not
kept together: nested packing locations are inside their parent section, so
keeping a section together would ask the browser to keep a whole bag tree on
one page. That wastes the bottom of pages, and fails anyway when the tree is
longer than a page.

**Check this first: some print behavior is not CSS.** A print stylesheet
cannot show content that is not in the DOM. The printed page simply lacks it,
and nothing on the paper shows the gap, because the control that removed it
is hidden too. Two cases exist. Both render differently while
`useIsPrinting()` is true, instead of using a class:

- Pack's row filters (`Show unpacked only` / `Show un-ready only`).
  `ListDetailPage` turns them off while printing; `PackSection` applies them.
- A collapsed `CategoryTable` section removes its body. `CategoryTable`
  shows every section as open while printing.

Both override the DERIVED value and leave the stored setting alone, so the
screen is unchanged after printing. Look for this pattern before you assume
a print stylesheet is enough.

The page box (`@page { margin: 0.5in }`) has no Tailwind utility form, so it
is in `src/index.css`.

## Breakpoints

Three hooks in `src/lib/use-breakpoint.ts` match Tailwind's breakpoints
exactly. Two choices make that true:

- **Range syntax, not `max-width`.** Tailwind's prefixes are min-width rules,
  and no `max-width` value is their exact opposite: any fractional bound
  misses the widths just above it. Browsers produce such widths under zoom
  and device emulation. In that gap, a control gated in JS and its CSS
  counterpart would both be missing, or both be present.
- **rem, not px.** Tailwind v4 emits `md`/`lg`/`xl` as `48rem`/`64rem`/`80rem`.
  These are 768/1024/1280px only at a 16px root font. If the user raises the
  browser's default text size, every Tailwind breakpoint moves, and a
  px-based hook would not.

The px figures below are therefore "at a 16px root font".

- `useIsBelowXl()` - the opposite of `xl:` (80rem, 1280px). Used only for
  Pack's Add gear button (`PackDocument`), which shows from `lg` to `xl`,
  where the picker aside is not on screen.
- `useIsBelowLg()` - the opposite of `lg:` (64rem, 1024px).
- `useIsMobile()` - the opposite of `md:` (48rem, 768px).

**A layout switch to a touch presentation must use `useIsBelowLg()`,**
because every touch-sized token in this file changes at `lg`, not `md`. A
surface that switches at `md` shows its dense desktop layout from 768 to
1023px while its controls are still touch-sized. `GearLibraryPage`,
`ListDetailPage` and `SharePage` switch with `useIsBelowLg()`.

The same rule applies to CSS. The mobile bottom bar is `lg:hidden`, so header
add buttons must show from `lg` up, not `md` up, or they appear twice from
768 to 1023px.

## Editing in place

Weight is edited with one control, `src/components/InlineWeight.tsx`, on
every surface that shows a weight: the List view row and the Pack row
(`ItemRow`), Pack food rows (`SortableFoodRow`), and the gear library row
(`GearItemRow`). Do not write another one: separate copies of its state
(draft, prop sync, focus, clamp, commit once) drift apart.

- Omit `onSave` for read-only: the public share, and food rows in Pack (food
  weight is edited in the Food view).
- Pass text color and width or visibility through `className`. The control
  owns the numeric token and the hover style, not the row's color.
- Pack rows, gear and food, pass `PACK_ROW_WEIGHT_CELL`. One bag holds both
  kinds of row, so their weight cells must have the same column geometry.
- Name and description are edited inline with `InlineText`, but not on a
  Pack row: there they are inside the label that toggles Packed, and an input
  there would conflict with that click. Weight is outside the label, so it
  can be edited in Pack. The edit dialog covers the other fields.

## Control target taxonomy

Which token an icon button uses depends on **where the control is and
whether it can be touched**, not on the icon.

| Control | Token | Size |
|---|---|---|
| **Leading** control of a row or section header: a drag grip, or the collapse chevron in the same column | `ROW_LEADING_CONTROL_TARGET` (or `RowIconButton touchSafe variant="dragHandle"`) | 40px touch / 28x20px pointer |
| Kebab or action icon elsewhere in a row or section header | `ROW_CONTROL_TARGET` (or `RowIconButton touchSafe`) | 40px touch / 28x24 pointer |
| Compact inline icon button in a surface that renders **only** at `lg+` | `RowIconButton` | 24x24 at `lg`, no touch box |
| Modal / drawer close button | `ROW_CONTROL_TARGET` | 40px touch / 28x24 pointer |
| Full-width disclosure button where the chevron is inline content | neither | the whole row is the hit area |
| Toolbar button, labeled options trigger, form stepper | neither (toolbar buttons compose `TOOLBAR_BUTTON`) | out of scope; bordered controls with their own padding |
| Compact panel header action (`PanelCard` `headerAction`) | neither | see below |

`RowIconButton` defaults to the compact desktop-only target. Callers that can
render below `lg` set `touchSafe`, which makes the component use
`ROW_CONTROL_TARGET`, or `ROW_LEADING_CONTROL_TARGET` when the caller also
sets `variant="dragHandle"` (every grip needs the narrow leading box, and
nothing else does). Callers whose surface cannot render below `lg` keep the
compact default. Modal and drawer close buttons use `ROW_CONTROL_TARGET`
directly. Section-header collapse chevrons use `ROW_LEADING_CONTROL_TARGET`
directly, because they are in the grip's column. A chevron that leads
nothing - the gear picker's own disclosure - stays square; the token is
about the shared column, not about chevrons.

Panel header actions are a third case. `PanelCard`'s header is `py-2` and
its `headerAction` slot is compact and aligned with the title; a 40px target
would make that header about 56px tall on mobile. The current site
(the Notes edit pencil in `ListDocument`) sets its own 24x24 box. This case
needs its own token and its own decision. Until then, do not use a row token
for it.

## Toggle taxonomy

Four components express on/off, either/or or "where am I", and they are not
interchangeable. Cited by `ToggleSwitch.tsx`.

| Component | Use for | Semantics |
|---|---|---|
| `ToggleSwitch` | Binary settings and in-content view toggles | `role="switch"` |
| `RowIconButton` (`purpleToggle` / `orangeToggle`) | Per-row flags on one item (worn, consumable) | button with an `active` chip state |
| `UnitSegmentedControl` | One of several mutually exclusive options | real `sr-only` radios behind visual labels |
| `ListViewNav` | The list's sections (List, Pack, Food) | links with `aria-current="page"` |

The mistakes to avoid:

- **Route views are navigation, not state.** Peer destinations with their own
  URLs are links with `aria-current="page"`, never pressed buttons.
- **Navigation and settings must not look alike.** The list's sections are
  underline tabs on their own row under the title (44px touch, 32px at
  `lg`). A value picker such as g/oz is a gray track with a white chip and
  no blue fill; each choice is 40px touch, 28px at `lg`.
- **More than two options is a radio group.** Use real radio inputs with
  visual labels, so keyboard arrow navigation works without extra code.
- **A row flag is not a setting.** It belongs to one item in a column of
  rows and follows the row control target rules, so it never uses
  `ToggleSwitch`, whose sizing is made for panels.

### Reserved space

Cited by `flat-table-styles.ts` and `src/gear/CategorySection.tsx`.

A control hidden with `opacity-0` still takes up its box, so rows that show a
drag handle on hover reserve its width on every row. Everything below follows
from one goal: **a section title and the item names under it start at the
same x position, in the normal read state.**

- **Content aligns per breakpoint, in the NORMAL state.** Select mode and
  rename mode are exempt; each changes the row, not the header. Do not "fix"
  them by tightening the header, because that breaks the state people view
  almost all the time.
- **A leading header control may reserve a row-control slot only if the rows
  reserve the same slot at that breakpoint.** The collapse chevron qualifies
  because every row leads with a drag handle of the same width.
- **Section-only controls go after the title, before the trailing columns.**
  They have no matching control in the rows, so they must not lead. The
  trailing columns match the rows' widths, so anything inserted there moves
  every label out of its column. After a `flex-1 min-w-0` title, the control
  takes its width from the flexible area instead.
- **The kebab stays last.** That keeps the trailing columns aligned.
- **Do not add space to every row to align a header.** A spacer on every data
  row to match a section-only control only moves the problem, and costs
  horizontal space on every row.
- **Disclosure stays an explicit button.** A header strip that is clickable
  everywhere causes mistaps on mobile.

The model is **column alignment, not tree indentation**: a section header is
not a parent node. These strips are column headers, and their trailing labels
align with the row values on purpose.

## Column widths

A section header's column labels must sit exactly above the row cells under
them. Header and row therefore use the same `COL_*` width token
(`flat-table-styles.ts`): `COL_ICON` (worn/consumable/kebab slot),
`COL_QTY` (pack rows), `COL_QTY_EDIT` (edit-row `InlineQuantity`),
`COL_QTY_MOBILE`, `COL_WEIGHT` (desktop weight), `COL_WEIGHT_MOBILE`,
`COL_PRICE`, `COL_DATE`. One token per COLUMN, not per width: two columns
with the same width today may differ later. The tokens set only width and
`shrink-0`; alignment and typography are added at the call site.

`ROW_HOVER_REVEAL` hides an in-row drag grip until the row is hovered or the
grip has focus. It is for desktop only; below `lg` the call site passes `''`,
because touch has no hover.

## Typography

### Headings and labels

- `FLAT_TABLE_HEADER_TITLE` - the one prominent section heading (category
  names). Keeps the user's capitalization; never uppercase.
- `FLAT_TABLE_HEADER_TITLE_MUTED` - the same, less prominent.
- `FLAT_TABLE_EYEBROW` - every small uppercase label: column labels in
  tables, summary stat labels, panel titles, disclosure toggles. One token,
  so their size, case and color stay the same.

### Body

- `FLAT_TABLE_BODY_TEXT` - body text on flat row surfaces.
- `FLAT_TABLE_BODY_TEXT_MUTED` - descriptions and secondary row text. Rows
  whose color changes with state (for example the packed strikethrough)
  compose `FLAT_TABLE_BODY_TEXT` plus an inline color instead.
- `FLAT_TABLE_META_TEXT` - small qty/weight chips and tiny in-row labels.
- `FLAT_TABLE_FOOTER_ROW` / `FLAT_TABLE_FOOTER_LABEL` /
  `FLAT_TABLE_FOOTER_VALUE` - the one recipe for a table's total row
  (category footers in `CategoryTable`, food day totals in
  `FoodDaySection`). Callers add their own display gate and gap. The gap is
  column geometry and must match that table's header and rows, or the total
  moves out of the Weight column. The label stays at `text-xs` on purpose:
  the mono value does not grow at `lg`, and a label that grows would sit
  lower or higher than the value beside it.
- `COMPACT_PANEL_BODY_TEXT` - compact stat panel body (`WeightTable` cells).
- `MARKDOWN_COMPACT_BODY_TEXT` / `MARKDOWN_COMPACT_HEADING_TEXT` - notes.
- `PANEL_TOGGLE_LABEL` - the label beside a `ToggleSwitch` in a control panel.
  Its color is `text-gray-900`.
- `PANEL_EMPTY_TEXT` - italic placeholder for empty panel content.

### Numbers

Four kinds of "number" in this app have different treatments. Decide the
kind before you choose a token:

| Kind | Meaning | Token | Mono? |
|---|---|---|---|
| **Value** | A measurement in a column: weight, cost, purchase date | `FLAT_TABLE_NUMERIC_TEXT` | yes |
| **Panel value** | A highlighted stat inside a compact panel | `COMPACT_PANEL_META_TEXT` | yes |
| **Quantity** | A count of items, in a Qty cell | `FLAT_TABLE_QUANTITY_TEXT` | no |
| **Numeric prose** | "Updated 5 min ago", "3 of 8 packed" | none; inline | no |

`font-mono` is for **values only**. Never use it on labels, item names,
category names, descriptions, notes, action buttons or panel labels. Mono
digits look larger than the system sans-serif font, so values stay at
`text-xs` on desktop instead of the 13px body size.

`tabular-nums` without `font-mono` is right for quantities and counts: the
digits do not shift as values change, and the number does not look like
measurement data. `tabular-nums` on text with no digits does nothing.

Other correct uses of `font-mono`: markdown `<code>` spans and the read-only
share URL input (`PrivacyPanel`). They are monospace for their own reasons,
not because of the numeric rule.

The Food view follows the same rule: `FLAT_TABLE_NUMERIC_TEXT` for values.
Numeric form inputs and counts keep tabular digits without mono.

## Chrome

Compact detail tables (`WeightTable`), `PanelCard` and the flat row tables
share one surface color, border color, divider color and radius, even where
their density and layout differ: `TABLE_RADIUS`, `TABLE_BORDER`,
`TABLE_SURFACE_BG`, `TABLE_HEADER_BG`, `TABLE_DIVIDER`,
`TABLE_STRONG_DIVIDER`.

`TABLE_DIVIDER_LINE` is the `divide-*` form of `TABLE_DIVIDER`, for rows
separated by a container-level `divide-y` instead of per-row borders. Same
gray; Tailwind's scanner needs the `divide-` class written out.

`FLAT_TABLE_SURFACE` is a table/list shell, **not** a decorative card:
rounded corners and a hairline border, no shadow. `overflow-hidden` clips
the row and header borders at the rounded edge. For the same reason, a
control positioned outside the surface is clipped, so it cannot be used for
drag handles in the gutter. On paper the surface does not clip
(`print:overflow-visible`), so wrapped names and page breaks are not cut.

Rows separated by a container-level `divide-y` must not use `FLAT_TABLE_ROW`
(its per-row `border-b` would draw a second line), but should still use
`MOBILE_ROW_HEIGHT` / `DESKTOP_ROW_HEIGHT` so they follow density changes.

`INLINE_EDIT_FOCUS_RING` exists because inline-edit controls already use a
blue border to mean "editing", so keyboard focus needs a separate ring.

### Buttons

Primary actions are the `PrimaryButton` component. `SECONDARY_BUTTON` is the
quiet action beside one (Cancel and similar buttons in dialog footers): the
same box as PrimaryButton's md size, gray text, gray hover.

### Form fields

`FORM_INPUT` is the standard text/number/select field: `rounded-lg` shell,
gray hairline border, `py-2` target, blue focus ring. Use it for form fields
so forms look the same across the app. Call sites add width, alignment
(`text-right tabular-nums`) and shape classes (`resize-none`,
`appearance-none`). Two known inline variants: the price field's `pl-6`
currency inset in `GearItemDialog` (uneven padding), and
`DeleteAccountSection`'s red focus ring (a danger form). Labels are the
`FormLabel` component, not a token.

On a `noValidate` form (`SignInPage`, for example), `minLength`, `required`
and similar attributes do nothing: client-side checks there are written in
JS. On every form, the server is the real check.

### Food view variants

The Food view shows each day of the meal plan as its own flat table, in the
same style as the category tables: a `FLAT_TABLE_SURFACE` card per day with
spacing set by the page, a `FLAT_TABLE_HEADER` strip that is also the
Qty / Weight column header, and a total row under the Weight column. Its
inline variants, each used in one place and not made into tokens:

- The editor dialog's meal grid (`FoodMealGrid`) uses native checkboxes in
  fixed-width grid cells. The CELL, not the 16px checkbox, is the target:
  `min-h-10` below `lg`, `lg:min-h-7` at `lg`. This is the two-tier rule,
  applied to a label around the input.
- Plan food lines are full-width buttons at the row height tokens
  (`MOBILE_ROW_HEIGHT` / `DESKTOP_ROW_HEIGHT`), indented (`pl-7`) under
  their meal label, without `FLAT_TABLE_ROW`'s borders: the meal grouping is
  a second heading level that the category tables do not have. Their Qty /
  Weight cells use `FoodDaySection`'s own column widths
  (`FOOD_PLAN_COL_QTY`, `FOOD_PLAN_COL_WEIGHT`), which match the category
  columns but may differ later. The Not scheduled table (`FoodView`) uses the
  same `FoodPlanColumnLabels` and `FoodPlanRow`.
- A plan row's Qty is the count at THAT meal (`quantity`). The List and Pack
  food rows show `unitCount`, the count for the whole trip. Same label,
  different number on purpose: each table answers its own page's question.

### Popover surface

`POPOVER_SURFACE` is the floating menu chrome: rounded card, hairline
border, white fill, soft shadow.

It is not part of `FLAT_TABLE_SURFACE`, because popovers float, have a shadow
and do not clip their content. Both share border color, radius and fill, so
the app's chrome looks the same; they differ in shadow and clipping on
purpose.

`KebabMenu` (`src/components/KebabMenu.tsx`) is the only component that uses
`POPOVER_SURFACE`. It is the one shell for menus and option popovers:
trigger, positioning, dismiss behavior, ARIA, and the surface (`fixed z-50`,
a width from its own list of literal width classes, and the caller's body
padding through `contentClassName`). New menus and popovers compose
`KebabMenu`, not the separate parts. Body padding is `py-1` (the default) for
menu rows and `p-2`/`p-3` for embedded panels (for example
`ListSettingsButton`).

## Tailwind v4 scanning

Tailwind finds only **whole class tokens** in the source. Never build a class
by inserting a fragment: `hover:${WORN_ICON_CLASS}` produces no CSS and
fails silently. That is why `RowIconButton`'s variant map repeats its color
strings in full. Putting a whole token into a template string
(`` `px-2 ${FLAT_TABLE_NUMERIC_TEXT}` ``) is safe, because each class still
appears in full in the source.

## Intentional exceptions

- **`WeightTable`** is a tighter compact-summary table and does not use the
  row density tokens.
- **`CategorySection`** (gear) headers use the row's own `gap-1.5` and
  `FLAT_TABLE_HEADER_PADDING` (`px-3`). The section drag grip sits after the
  title, so the header has no extra leading column, and the chevron, the
  title and both ends of the trailing columns line up with the row with no
  adjustment. Do not add a tighter header variant without re-measuring all
  four columns.
- **Picker rows** (`LibraryPanel`) and draft/footer rows use a flat `px-3`
  on mobile instead of `FLAT_TABLE_ROW_PADDING`.
- **List-view and gear rows** (`itemRowShell`, used by the non-pack `ItemRow`,
  `FoodRow` and `GearItemRow`) also keep `px-3` on mobile instead of the standard
  `px-2`: on mobile they show fewer columns than pack rows, so the wider
  inset reads better. Do not change this to `FLAT_TABLE_ROW_PADDING` in a
  density cleanup.
- **Modal titles, primary buttons and auth pages** are not row/table/panel
  chrome, and these tokens do not apply to them.
