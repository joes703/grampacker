# UI Density

This app uses different density for touch and pointer input. That is intentional:
mobile rows need finger-sized targets, while desktop rows can be denser for scanning.
Consistency means the same density within the same input mode, not the same pixel
height on every viewport.

## Rows And Section Headers

Mobile / touch:

- Item rows use a 44px minimum height: `min-h-11`.
- Category and section headers use a 44px minimum height: `min-h-11`.

Desktop / pointer:

- Item rows use a 32px minimum height: `lg:min-h-8`.
- Category and section headers use a 36px minimum height: `lg:min-h-9`.

Current row-like surfaces that should follow this rule:

- List detail rows.
- Pack mode rows.
- Gear page rows.
- Gear picker rows.
- Public share rows, through the reused list components.
- List, gear, picker, and share category headers.

## Row Controls

Controls inside rows and section headers have their own target sizes. Increase the
target box when needed; do not make the glyph itself large just to hit the target.

Mobile / touch:

- Explicit chevrons, kebabs, and drag handles inside rows or headers use a 40px square target: `h-10 w-10`.
- Icon glyphs inside those targets should usually stay around 13-16px.

Desktop / pointer:

- Explicit row/header controls use a 28px square target: `lg:h-7 lg:w-7`.
- Desktop-only inline icon buttons may use the compact `RowIconButton` sizing when they do not render on mobile.

## Visual Grammar

- Category headers are flat divider strips, not cards — but on the content views each
  whole category is wrapped in its own flat-table card (see "Surfaces consuming the
  module"). The header stays a `bg-gray-50` strip inside that card.
- Label typography is two tiers, both centralized (see "Shared style module"):
  - **Title** (`FLAT_TABLE_HEADER_TITLE`) — the one prominent section heading, used
    only for category names. Preserves the user's capitalization; never uppercased.
  - **Eyebrow** (`FLAT_TABLE_EYEBROW`) — every small uppercase micro-label: in-table
    column labels (`Qty`, `Weight`, `Price`, `Purchased`), summary stat labels (`Base`,
    `Consumable`), panel titles (`Notes`, `Weight summary`, `Add from gear`), and the
    breakdown disclosure. One token so these don't drift in size/case/color.
  - Counts use the subdued tabular `FLAT_TABLE_HEADER_COUNT` metadata text.
- Item/list rows are table rows, not mini cards.
- Use columns, icons, and content to express function instead of extra containers or gaps.
- The gear picker is the reference for the flat row language: simple headers, simple rows, and borders doing the separation.
- List detail, pack mode, gear inventory, lists, and share views may have different columns, but should not introduce a different row/card visual system without a deliberate reason.

## Row Menus

Row and category kebab menus use `RowMenuItem` / `RowMenuSeparator` from
`src/components/RowMenuItem.tsx`.

- Neutral actions are gray.
- Reversible membership actions use the `removal` tone: calm red text with a neutral
  hover surface.
- Destructive actions use the `danger` tone: red text and a red hover surface, usually
  followed by a confirm dialog.

Do not create a local `MenuItem` helper in row/list/category files unless the menu has a
different interaction model.

## Shared Style Module

The cross-surface invariants live in `src/components/flat-table-styles.ts` so a
density or grammar change happens in one place instead of drifting across one-off
Tailwind strings. The exports are *base fragments*: each call site composes its own
gap / padding / column / hover / selected classes around them.

- `FLAT_TABLE_SURFACE` — white table shell (`overflow-hidden rounded-lg border
  border-gray-200 bg-white`). The app background is gray-50 and section headers are
  gray-50, so a flat table needs a white surface or its headers vanish into the page. A
  table/list shell, not a decorative card: rounded corners + a hairline border, no
  shadow. The corner radius lives in the constant so every flat table rounds
  identically; a surface that must be square overrides `rounded-none` at the call site.
- `FLAT_TABLE_HEADER` — section/category header divider strip (`bg-gray-50` + bottom
  border, `min-h-11 lg:min-h-9`).
- `FLAT_TABLE_HEADER_TITLE`, `FLAT_TABLE_HEADER_TITLE_MUTED`,
  `FLAT_TABLE_HEADER_COUNT`, and `FLAT_TABLE_EYEBROW` — shared title / count /
  micro-label typography (see the two-tier rule under "Visual Grammar"). The eyebrow
  is the single small-uppercase label used by both in-table column labels and the
  summary panels, so they don't drift in capitalization, weight, or size.
- `FLAT_TABLE_ROW` — item/list row (`min-h-11 lg:min-h-8` + bottom border). Rows
  separated by a container `divide-y` must NOT use this (the per-row border-b would
  double up) — see the ListsPage row exception below.
- `ROW_CONTROL_TARGET` — chevron/kebab/drag-handle target box (`h-10 w-10 lg:h-7
  lg:w-7`). Distinct from `RowIconButton`, the compact desktop-only inline icon button
  (28x24) that never renders on mobile and so needs no touch box.
- Shared chrome tokens (`TABLE_RADIUS`, `TABLE_BORDER`, `TABLE_SURFACE_BG`,
  `TABLE_HEADER_BG`, `TABLE_DIVIDER`, `TABLE_STRONG_DIVIDER`, and `TABLE_DIVIDER_LINE` —
  the `divide-*` color sibling of `TABLE_DIVIDER` for `divide-y` row groups) are used by
  flat tables, list-detail panels, settings sections, `PanelCard`, and compact detail
  tables so border/radius/tint changes flow through without forcing every table to share
  the same row density.

### Typography Tokens

Heading-and-label typography is the two-tier `FLAT_TABLE_HEADER_TITLE` / `FLAT_TABLE_EYEBROW`
pair above. The body/meta/numeric tokens below cover row body content, compact panels, and
markdown notes — they live alongside the chrome tokens in
`src/components/flat-table-styles.ts` so a desktop/mobile font-size experiment happens in
one place instead of being chased across one-off Tailwind strings.

The contract is "always reach the token from row/table/panel surfaces, never re-derive the
size inline." Today all tokens are unified across viewports (mobile and desktop see the
same `text-sm`/`text-xs`); the tokens exist to make a future tuning pass cheap.

- `FLAT_TABLE_BODY_TEXT` — body text on flat row surfaces. Item rows, picker rows, footer
  rows, rename inputs, empty-state primary copy. Call sites compose `font-normal` or other
  weights + color separately when needed.
- `FLAT_TABLE_BODY_TEXT_MUTED` — muted body variant for descriptions and secondary copy on
  rows. `text-sm font-normal text-gray-500`. Used for item descriptions in share/owner
  read paths. Rows that flip color reactively (e.g. `ItemRow`'s `is_packed` strikethrough)
  keep their inline color override and compose `FLAT_TABLE_BODY_TEXT` + `font-normal`
  instead.
- `FLAT_TABLE_META_TEXT` — compact metadata text. Small qty/weight chips and tiny labels
  inside rows where a body-text chip would overpower the surrounding content.
- `FLAT_TABLE_NUMERIC_TEXT` — tabular-nums variant of `FLAT_TABLE_META_TEXT` for
  column-aligned numeric chips (qty / weight right rails). Same size as `META_TEXT` today
  but kept separate because future tuning of numeric vs text metadata might diverge.
- `COMPACT_PANEL_BODY_TEXT` — compact stat panel body text (`WeightTable` cells). Denser
  than flat-row body text because these panels are summary surfaces, not list rows. Same
  value as `FLAT_TABLE_META_TEXT` today but a distinct token: the surfaces are
  conceptually different and may tune independently.
- `COMPACT_PANEL_META_TEXT` — stat-panel value typography (`WeightSummary` stat values
  and similar emphasis values inside compact panels). `text-sm font-medium tabular-nums`
  so values read as numbers, not body text. Call sites add the color (most use
  `text-gray-900` to anchor the value).
- `MARKDOWN_COMPACT_BODY_TEXT` — markdown notes body text (`p`, `ul`, `ol`, `blockquote`
  inside `MarkdownContent`). Same size as `FLAT_TABLE_BODY_TEXT` today; kept separate so
  notes can diverge for readability (wider line-height, larger font) if a future tuning
  pass calls for it.
- `MARKDOWN_COMPACT_HEADING_TEXT` — markdown notes heading typography (`h2`, `h3` inside
  `MarkdownContent`). The `h1` element stays inline at the call site (`text-base`)
  because it's the only site at that size and doesn't repeat.
- `PANEL_TOGGLE_LABEL` — text label sitting next to a `ToggleSwitch` inside a control
  panel (`PrivacyPanel` "Sharing", `ListSettingsPanel` "Group worn items" and "Ready
  checks (pack mode)", `PackingProgress` "Show unpacked only"). Canonical color is
  `text-gray-900` so active setting/control labels read as primary panel content; helper
  or descriptive copy next to them stays lighter. An earlier `PackingProgress` site
  carried `text-gray-700` for the same role; that drift is intentionally resolved to
  `text-gray-900` by this token.
- `PANEL_EMPTY_TEXT` — empty-state placeholder ("No notes") shown inside notes-style
  panel surfaces (`NotesEditor` read state, `SharePage` notes block). Italic plus
  `text-gray-400` so the placeholder reads as absent content rather than active text.
  Distinct from row empty states ("No items" in a category), which use
  `FLAT_TABLE_BODY_TEXT` + the row surface's italic + color — that pattern is one site
  (`CategorySection`) and stays composed inline.

Out of scope (intentional): modal titles, primary CTAs, auth pages, button toolbars,
form fields, and other surfaces that are not row/table/panel chrome. Strings used only
once anywhere in the codebase also stay inline — these tokens exist for repeated patterns,
not for every literal `text-*` class.

### Surfaces consuming the module

White table surface (`FLAT_TABLE_SURFACE`, rounded corners included). Two layouts:

- **Card per category** — list detail, gear inventory, and share wrap *each* category
  (`CategoryGroup` / `CategorySection`) in its own surface card, and the page composes
  the gaps with a `flex flex-col gap-3` column. This gives visible separation between
  categories while every card stays consistent.
- **Single continuous surface** — the lists-page row list and the gear picker (desktop
  aside + mobile drawer) are one surface wrapping a flush list. The picker deliberately
  does NOT use card-per-category: its categories live inside the aside/drawer surface,
  so per-category cards would be nested cards (which we don't do).

None compose their own radius.

Header / row / control bases: list-detail + share + pack category headers
(`CategoryGroup`), gear-inventory headers (`CategorySection`), gear-picker headers and
rows (`LibraryPanel`), list/pack rows (`ItemRow`), gear rows (`GearItemRow`), and the
chevrons / lists-page kebab + drag handle.

### Intentional exceptions

- **ListsPage rows** keep their density (`min-h-11 lg:min-h-8`) inline instead of using
  `FLAT_TABLE_ROW`, because separators come from the `<ul>`'s `divide-y`; a per-row
  `border-b` would double the line. Documented at the call site.
- **WeightTable rows** are a compact density exception (`text-xs` with very tight
  padding). They should not use `FLAT_TABLE_ROW`, but their surrounding summary surfaces
  and divider colors use the shared table chrome tokens: row groups separate with
  `divide-y ${TABLE_DIVIDER_LINE}` and the total rules use `TABLE_STRONG_DIVIDER`, so the
  table carries no one-off divider tints.
- **Popover menus, `PanelCard`, and the weight/progress stat panels** also use
  `border border-gray-200 bg-white` but are not flat row tables (floating menus, titled
  cards, stat grids), so they do not consume `FLAT_TABLE_SURFACE`.

## Toggle Taxonomy

Four families plus nav active-state. Visual distinction across families is intentional;
visual consistency within a family is enforced by reusing the shared component. Pick by
what the control does, not which one looks closest.

- **`ToggleSwitch`** (`src/components/ToggleSwitch.tsx`) — iOS-style sliding switch. The
  default for **binary on/off controls anywhere in the app**, including settings panels
  (Group worn items, the public-link toggle in Sharing) AND in-content view toggles
  (Show unpacked only, Ready checks inside PackingProgress). One switch shape everywhere
  so the user sees the same control regardless of whether the state is persistent or
  local view state.

- **`PillToggle`** (`src/components/PillToggle.tsx`) — rounded border, fills with blue-50/
  blue-700 when active. Reserved for **page/list mode toggles**. Currently the only
  consumer is Pack mode (desktop ListDocumentToolbar + MobilePackToggle). Mode = "the
  whole surface behaves differently while this is on"; binary settings inside that surface
  do NOT belong here. If you find yourself adding a second PillToggle for a non-mode
  binary, it's a ToggleSwitch instead.

- **`RowIconButton`** with `purpleToggle` / `orangeToggle` variants
  (`src/components/RowIconButton.tsx`) — 28×24 inline icon-only button, hover-revealed
  when idle, tinted when active. For **per-row tag flags** (Worn, Consumable). Scoped to
  list/table row chrome.

- **`UnitSegmentedControl`** (`src/components/UnitSegmentedControl.tsx`) — two-segment
  radio-like control. For **mutually exclusive option selection** (g/oz). Generalize into
  a future `SegmentedControl` only if a second use case appears.

- **`MobileBottomBar`** item with `active: true` — text color shift only, no border or
  fill. **Nav active-state**, not a control. Don't reach for it as a toggle.

The simple rule when in doubt: binary on/off → `ToggleSwitch`. Pick-one-of-N →
`UnitSegmentedControl`. Per-row tag → `RowIconButton`. Pack-mode-style "this whole view
flips" → `PillToggle`. Anything else is a normal button.

### Visual rules

These keep the toggle family from drifting into visually inconsistent territory even when
each call site uses the correct component:

- **`ToggleSwitch` labels sit next to their switches**, not at the opposite edge of the
  container. A `flex items-center justify-between` row inside a wide content panel pushes
  the switch hundreds of pixels away from its label and the two stop reading as one
  control. Use a shrink-to-content layout instead (e.g. a `grid-cols-[max-content_max-content]`
  grid for stacked rows, or a constrained-width wrapper) so the label and switch always
  travel together. The full-width `justify-between` pattern is only acceptable when the
  container itself is already narrow (a popover, a modal, or a settings list column).

- **`UnitSegmentedControl` is a compact value selector**, not a mode toggle. It should
  be readable and touchable (`text-sm`, modest padding, equal-width segments), but flatter
  than action buttons and Pack's PillToggle (`rounded-md` shell, small inner radius). If
  it starts looking like a chunky pill button, it'll compete visually with Pack; if it
  shrinks to tiny text, it stops feeling like a real control.

- **`PillToggle` is reserved for page/list mode buttons**, currently Pack only. It's
  intentionally chunkier than `UnitSegmentedControl` because it represents "the whole
  surface behaves differently while this is on." Adding a second PillToggle for a non-
  mode binary will dilute that meaning; use `ToggleSwitch` instead.

## Changing Density Later

When changing row density, update all row-like surfaces together and verify with grep.
The important classes to audit are:

- `min-h-11`
- `lg:min-h-8`
- `lg:min-h-9`
- `h-10 w-10`
- `lg:h-7 lg:w-7`

After a density change, verify mobile and desktop separately. In particular, check the
gear picker drawer because it is lazy-loaded and can appear stale until the PWA/browser
session fully reloads.
