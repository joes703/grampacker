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
