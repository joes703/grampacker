// Shared visual grammar for grampacker's flat row/table surfaces.
// See docs/ui-density.md. The gear picker (LibraryPanel) is the reference
// implementation of this language.
//
// These are *base* fragments, not finished class strings. Each call site
// composes its own layout-specific gap / padding / column / hover / selected
// classes around the base. The constants own the cross-surface invariants
// (touch-vs-pointer density, border + background language, control target
// sizing) so a density or grammar change happens in exactly one place
// instead of drifting across one-off Tailwind strings.

// Shared chrome tokens. Compact detail tables (WeightTable), PanelCard, and
// the flat row tables use the same surface color, border color, subtle tint,
// divider color, and radius even when their density/layout differs.
export const TABLE_RADIUS = 'rounded-lg'
export const TABLE_BORDER = 'border border-gray-200'
export const TABLE_SURFACE_BG = 'bg-white'
export const TABLE_HEADER_BG = 'bg-gray-50'
export const TABLE_DIVIDER = 'border-gray-100'
export const TABLE_STRONG_DIVIDER = 'border-gray-200'
// `divide-*` color sibling of TABLE_DIVIDER, for row groups separated by a
// container-level `divide-y` (e.g. WeightTable) rather than per-row borders.
// Same gray as TABLE_DIVIDER; Tailwind just needs the divide- form spelled
// out literally for the JIT scanner to emit it.
export const TABLE_DIVIDER_LINE = 'divide-gray-100'

// White table shell. The app background is gray-50, and section headers are
// gray-50 too, so a flat table needs a white surface or its headers vanish
// into the page. This is a table/list shell, NOT a decorative card: rounded
// corners + a hairline border, no shadow. overflow-hidden clips child
// row/header borders flush to the rounded container edge. The corner radius
// lives here so every flat table rounds identically — broad radius changes
// happen in one place. A surface that must be square is an explicit
// exception that overrides `rounded-none` at the call site.
export const FLAT_TABLE_SURFACE = `overflow-hidden ${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG}`

// Section / category header: a flat divider strip, not a card. Touch 44px /
// pointer 36px (see docs/ui-density.md). Compose gap + horizontal padding
// (+ `w-full` where the header is a flex child that must fill its track).
export const FLAT_TABLE_HEADER =
  `flex min-h-11 lg:min-h-9 items-center ${TABLE_HEADER_BG} border-b ${TABLE_DIVIDER}`

// Header/label typography. Two tiers:
//   - TITLE: the one prominent section heading (category names). Preserves
//     user-entered capitalization, so it is never uppercased.
//   - EYEBROW: every small uppercase micro-label — in-table column labels
//     (Qty / Weight / Price / Purchased), summary stat labels (Base /
//     Consumable), panel titles (Notes / Weight summary), and disclosure
//     toggles. One token so these don't drift apart in size/case/color.
// COUNT is the subdued tabular metadata count beside a title.
export const FLAT_TABLE_HEADER_TITLE = 'text-sm font-medium text-gray-700'
export const FLAT_TABLE_HEADER_TITLE_MUTED = 'text-sm font-medium text-gray-400'
export const FLAT_TABLE_HEADER_COUNT = 'text-xs font-normal tabular-nums text-gray-400'
export const FLAT_TABLE_EYEBROW =
  'text-[10px] font-semibold uppercase tracking-wider text-gray-500'

// Item / list row: a table row, not a mini card. Touch 44px / pointer 32px.
// The bottom border does the separation. Compose gap / padding / hover /
// selected-tint / bg-white at the call site (rows differ: some are white,
// some carry a selected tint, the mobile swipe row moves padding inward).
// NOTE: rows separated by a container-level `divide-y` (e.g. ListsPage)
// should NOT use this — the per-row border-b would double up.
export const FLAT_TABLE_ROW =
  `flex min-h-11 lg:min-h-8 items-center border-b ${TABLE_DIVIDER}`

// Explicit chevron / kebab / drag-handle target inside a row or header:
// 40px touch / 28px pointer. Compose color + hover + `shrink-0` at the call
// site. Distinct from RowIconButton, which is the compact desktop-only inline
// icon button (28x24) that never renders on mobile and so needs no touch box.
export const ROW_CONTROL_TARGET =
  'inline-flex h-10 w-10 lg:h-7 lg:w-7 items-center justify-center rounded'
