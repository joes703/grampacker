# UI density and design tokens

**BINDING, maintained against the code.** Source of truth for grampacker's
row/table/panel visual grammar. Cited by
`src/components/flat-table-styles.ts` and `src/components/ToggleSwitch.tsx`.

The tokens live in `src/components/flat-table-styles.ts`. This document
explains the reasoning behind them and, more importantly, records **which
token owns which control** so the choice is a lookup rather than a judgment
call. The gear picker (`LibraryPanel`) is the reference implementation of the
row language.

## How to use this

**Consult it; do not try to satisfy it.** Most of this file is an index of
what exists and why, for when you are about to build a surface and want to
know whether the thing you need is already named. It is not a checklist, and
a change is not wrong because it does not appear here.

Three ideas carry the rest:

1. **Compose the vocabulary, don't re-type it.** The tokens own the
   cross-surface invariants - density, border and background language, control
   sizing - so a change happens in one place instead of drifting across one-off
   Tailwind strings. They are base fragments; call sites still add their own
   layout, gap and hover classes.
2. **Tokens are for repeats.** A string used once stays inline. Hoist when a
   second surface wants it, not in anticipation.
3. **Density is two tiers, and they move independently.** Mobile is tuned for
   touch, desktop for pointer scanning. Tuning one must not move the other.

## Two density tiers

Mobile is tuned for touch, desktop for pointer scanning. Pointer users
tolerate denser body type than touch readers, so **mobile sizes must stay
unchanged whenever desktop is tuned**.

| | Mobile (< lg) | Desktop (>= lg) |
|---|---|---|
| Row height | 44px (`min-h-11`) | 28px (`lg:min-h-7`) |
| Header height | 44px (`min-h-11`) | 32px (`lg:min-h-8`) |
| Row control target | 40px (`h-10 w-10`) | 28x24px (`lg:h-7 lg:w-6`) |
| Leading control target | 40px (`h-10 w-10`) | 28x20px (`lg:h-7 lg:w-5`) |
| Row padding | `px-2 py-2` | `lg:px-3 lg:py-0` |
| Header padding | `px-3 py-0` | `px-3 py-0` |
| Body text | 14px (`text-sm`) | 13px (`lg:text-[13px]`) |

The desktop header is deliberately 4px taller than the desktop row so the
section divider still reads as a distinct strip without bulking into a
card-like band.

Neither desktop control column is square, and they are narrow for different
reasons. The TRAILING column (kebabs, action icons) sits at 24px wide because
that is the WCAG 2.2 SC 2.5.8 floor, so each control clears the requirement on
its own. It could be smaller - the spec's spacing exception would probably
cover it, as it does for the leading column - but that exception depends on
the gaps around a control and so has to be re-argued whenever the surrounding
layout moves. An independently compliant box does not. It was 28px, which
cleared the floor by 4px that bought nothing and left a 14px glyph rattling
inside its box on every row.

The LEADING control column is narrower still, and the
reason is the glyph rather than the gesture. A kebab fills its box, so 28x24
reads as a tight control; `GripVertical` draws two thin columns of dots about
6px wide, so the same box strands ~11px of visible dead space either side and
every draggable row opens with a wide empty gutter. Only the width comes in -
the 28px height is the desktop row height, so it costs nothing - and mobile
keeps the full 40px square, which a thumb needs.

Two controls share that column and must stay the same width: a section
header's collapse chevron and a row's drag grip (see "Reserved space" below).
Narrowing the grip alone shifts every item name 8px left of the category title
above it. They therefore read one token,
`ROW_LEADING_CONTROL_TARGET` - a single width cannot fall out of sync with
itself - and the chevron glyph is 14px so it still breathes inside the
narrower box. `CategorySection.alignment.test.tsx` asserts the two rendered
boxes carry identical sizing classes; DOM-order assertions alone cannot see
this regression.

13px (`lg:text-[13px]`) is a deliberate tier between Tailwind's `text-xs`
(12px) and `text-sm` (14px). It gives denser desktop scanning without the eye
strain of 12px. The arbitrary value is safe for Tailwind v4's JIT scanner
because the literal appears statically in the tokens file.

Desktop rows target a Lighterpack-style density where the eye scans columns
more than it reads sentences.

## Breakpoints

Three hooks in `src/lib/use-breakpoint.ts` mirror Tailwind exactly. Two things
make that "exactly" true, and both look like fussiness until they break:

- **Range syntax, not `max-width`.** Tailwind's prefixes are min-width rules,
  and no `max-width` value is their complement - `63.9375rem` misses just above
  itself, and any fractional bound misses just above *itself*. Browsers produce
  those widths under zoom and device emulation, and in the gap a JS-gated
  control and its CSS counterpart are both absent, or at the other boundary
  both present.
- **rem, not px.** Tailwind v4 emits `md`/`lg`/`xl` as `48rem`/`64rem`/`80rem`.
  Those equal 768/1024/1280px only at a 16px initial font; raise the browser's
  default text size and every Tailwind breakpoint moves while a px-based hook
  stays put.

Px figures below are therefore "at a 16px initial font", not fixed truths.

- `useIsBelowXl()` - the negation of `xl:` (80rem, 1280px). Used only for
  Pack's Add gear trigger, which exists exactly where the picker aside does not
- `useIsBelowLg()` - the negation of `lg:` (64rem, 1024px)
- `useIsMobile()` - the negation of `md:` (48rem, 768px)

Comments elsewhere in the tree still name px bounds from before this changed.
They are stale in wording only; the queries themselves are all rem.

## Editing in place

Weight is edited through one control, `src/components/InlineWeight.tsx`, on
every surface that shows one: the Category row, the Pack row, and the gear
library row. Do not hand-roll a fourth.

It exists because those surfaces had drifted - the list row could edit a
weight in place, the gear library could only reach it through a dialog, and
the Pack row showed no weight at all. Three copies of the same state machine
(draft, prop-sync, focus, clamp, commit-once) is how that happened.

- Omit `onSave` for read-only: the public share view, and food rows in Pack
  (food weight is authored in the Food view).
- Pass text color and width/visibility through `className`; the control owns
  the numeric token and the hover affordance, not the row's color.
- Name and description are edited inline by `InlineText`. On a Pack row they
  deliberately are NOT: those sit inside the label that toggles Packed, and an
  input there would fight the gesture. Weight sits outside it, which is the
  whole reason weight can be edited in Pack and the other fields cannot - the
  dialog covers them.

**Layout swaps that hand off to a touch presentation must use
`useIsBelowLg()`**, because every touch-sized token in this file compacts at
`lg`, not `md`. A surface that swaps at `md` renders its dense desktop
presentation across 768-1023px while its controls are still sized for touch,
or worse, sized for pointer on a touch device.

`FoodLibraryPage`, gear, and lists all use `useIsBelowLg()` for their
touch/dense layout handoff.

This is a recurring bug class in this repo. The mobile bottom bar is
`lg:hidden`, so header add-affordances must be gated `lg+` and not `md+` or
they double-render across 768-1023px.

## Control target taxonomy

The question "which token does this icon button use?" is decided by **where
the control lives and whether it can be touched**, not by what the icon is.

| Control | Token | Size |
|---|---|---|
| **Leading** control of a row or section header: a drag grip, or the collapse chevron that shares its column | `ROW_LEADING_CONTROL_TARGET` (or `RowIconButton touchSafe variant="dragHandle"`) | 40px touch / 28x20px pointer |
| Kebab or action icon elsewhere in a row or section header | `ROW_CONTROL_TARGET` (or `RowIconButton touchSafe`) | 40px touch / 28x24 pointer |
| Compact inline icon button in a surface that renders **only** at `lg+` | `RowIconButton` | 24x24, no touch box |
| Modal / drawer close button | `ROW_CONTROL_TARGET` | 40px touch / 28x24 pointer |
| Full-width disclosure button where the chevron is inline content | neither | the whole row is the hit area |
| Toolbar button, labeled options trigger, form stepper | neither | out of scope; bordered controls with their own padding |
| Compact panel header action (`PanelCard` `headerAction`) | neither | see below |

`RowIconButton` defaults to the narrow desktop-only target. Callers that can
render below `lg` set `touchSafe`, which makes the component consume
`ROW_CONTROL_TARGET` - or `ROW_LEADING_CONTROL_TARGET` when the caller also
sets `variant="dragHandle"`, since every grip wants the narrow leading box and
nothing else does. Callers whose containing surface provably cannot render
below `lg` retain the compact default. Modal and drawer close buttons consume
`ROW_CONTROL_TARGET` directly. Section-header collapse chevrons consume
`ROW_LEADING_CONTROL_TARGET` directly, because they sit in the grip's column.
A chevron that leads nothing - the gear picker's standalone disclosure - stays
square; the token is about the shared column, not about chevrons.

Panel header actions are genuinely a third case. `PanelCard`'s header is
`py-2` and documents `headerAction` as compact and baseline-aligned; a 40px
target would push that header to roughly 56px on mobile. `ROW_CONTROL_TARGET`
is documented for row and header chrome, not compact panel actions. The
current site (`ListDetailPage`'s edit-notes pencil) hand-rolls 24x24. This
needs its own token and its own decision; until it has one, do not force a
row token onto it.

## Toggles: pick by what the state MEANS

Three components express on/off or either/or, and they are not
interchangeable. Cited by `ToggleSwitch.tsx`.

| Component | Use for | Semantics |
|---|---|---|
| `ToggleSwitch` | Binary settings and in-content view toggles | `role="switch"` |
| `RowIconButton` (`purpleToggle` / `orangeToggle`) | Per-row flag markers on one item (worn, consumable) | button with an `active` chip state |
| `UnitSegmentedControl` | One of several mutually exclusive options | real `sr-only` radios behind visual labels |

The three mistakes worth naming:

- **Route views are navigation, not state.** Peer destinations with their own
  URLs are links with `aria-current="page"`, never pressed buttons.
- **More than two options is a radio group.** Use real radio inputs, visually
  relabeled - keyboard arrow navigation then works without reimplementing it.
- **A row flag is not a setting.** It belongs to one item in a scanning
  column and obeys the row control target rules, so it never uses
  `ToggleSwitch`, whose sizing is tuned for panel chrome.

### Reserved space

Restored 2026-08-11 - a compression pass deleted this section while three
code sites still cite it by name (`flat-table-styles.ts`,
`CategorySection.tsx`, `CategorySection.alignment.test.tsx`).

A control hidden with `opacity-0` still occupies its box, so rows that
hover-reveal a drag handle reserve its width on every row. Everything below
follows from one goal: **a section title and the item names beneath it start
at the same x, in the normal read state.**

- **Content aligns per breakpoint, in the NORMAL state.** Select mode and
  rename mode are knowingly exempt - each reshapes the row rather than the
  header. Do not "fix" either by re-tightening the header; that breaks the
  state almost all viewing happens in.
- **A leading header control may reserve a row-control slot only if the rows
  reserve an equivalent slot at that breakpoint.** The collapse chevron
  qualifies because every row leads with a drag handle of the same width.
- **Section-only controls go after the title, before the trailing rail.** They
  have no per-row counterpart, so they must not lead; and the trailing
  columns are width-matched to the row's, so anything inserted there shifts
  every label off-column. After a `flex-1 min-w-0` title, the control takes
  its width from the flexible region instead.
- **The kebab stays last.** That is what keeps the trailing rail aligned.
- **Never buy alignment by taxing the rows.** A stub on every data row to
  match a section-only control moves the problem and spends horizontal space
  on every row.
- **Disclosure stays an explicit button.** A fully-clickable header strip was
  removed deliberately, for mobile mistaps.

The frame is **column alignment, not tree indentation**: a section header is
not a parent node, and these strips are treated as column headers whose
trailing labels align to row values on purpose.

## Typography

### Headings and labels

- `FLAT_TABLE_HEADER_TITLE` - the one prominent section heading (category
  names). Preserves user capitalization; never uppercased.
- `FLAT_TABLE_HEADER_TITLE_MUTED` - same, de-emphasized.
- `FLAT_TABLE_EYEBROW` - every small uppercase micro-label: in-table column
  labels, summary stat labels, panel titles, disclosure toggles. One token so
  these do not drift apart in size, case, or color.

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

Four different things in this app are "numeric" and they do not share a
treatment. Classify before reaching for a token:

| Kind | Meaning | Token | Mono? |
|---|---|---|---|
| **Value** | A measurement in a column: weight, cost, purchase date | `FLAT_TABLE_NUMERIC_TEXT`, or `NUMERIC_VALUE_TEXT` when the caller owns its size | yes |
| **Panel value** | An emphasis stat inside a compact panel | `COMPACT_PANEL_META_TEXT` | yes |
| **Quantity** | A count of items, in a Qty cell | `FLAT_TABLE_QUANTITY_TEXT` | no |
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

The food module uses the same numeric treatment as the rest of the app.
`NUMERIC_VALUE_TEXT` supplies `font-mono tabular-nums` without choosing a font
size; food tables, cards, editor totals, entry previews, and import-preview
value columns compose it with their existing size tier. Dense row values that
do not own a separate hierarchy use `FLAT_TABLE_NUMERIC_TEXT`. Numeric form
inputs and count metadata intentionally keep tabular digits without mono.

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

### Form fields

`FORM_INPUT` is the canonical text/number/select field: `rounded-lg` shell,
gray hairline, `py-2` target, blue focus ring. It was the same literal string
copy-pasted across every dialog form until the food view's add form invented
a smaller private variant and shipped looking like a different app - which is
exactly the drift tokens exist to prevent, so the literal is now hoisted.
Call sites compose width, alignment (`text-right tabular-nums`), and shape
extras (`resize-none`, `appearance-none`) around it. Documented variants that
stay inline: the price field's `pl-6` currency inset (asymmetric padding) and
`DeleteAccountSection`'s red focus ring (danger form). Labels are the
`FormLabel` component, not a token.

### Toggle chips

`TOGGLE_CHIP` + `TOGGLE_CHIP_ON` / `TOGGLE_CHIP_OFF` are pill-shaped
pressed/unpressed multi-select chips (the food slot picker). Density follows
the standing rule: `min-h-10` touch floor on mobile, desktop shrinks to the
28px pointer tier and the shared 13px body scale. The ON state is the blue
tint pair used by `aria-pressed` controls.

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
