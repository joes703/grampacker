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

// White table shell. The app background is gray-50, and section headers are
// gray-50 too, so a flat table needs a white surface or its headers vanish
// into the page. This is a table/list shell, NOT a decorative card: rounded
// corners + a hairline border, no shadow. overflow-hidden clips child
// row/header borders flush to the rounded container edge. The corner radius
// lives here so every flat table rounds identically — broad radius changes
// happen in one place. A surface that must be square is an explicit
// exception that overrides `rounded-none` at the call site.
export const FLAT_TABLE_SURFACE = 'overflow-hidden rounded-xl border border-gray-200 bg-white'

// Section / category header: a flat divider strip, not a card. Touch 44px /
// pointer 36px (see docs/ui-density.md). Compose gap + horizontal padding
// (+ `w-full` where the header is a flex child that must fill its track).
export const FLAT_TABLE_HEADER =
  'flex min-h-11 lg:min-h-9 items-center bg-gray-50 border-b border-gray-100'

// Item / list row: a table row, not a mini card. Touch 44px / pointer 32px.
// The bottom border does the separation. Compose gap / padding / hover /
// selected-tint / bg-white at the call site (rows differ: some are white,
// some carry a selected tint, the mobile swipe row moves padding inward).
// NOTE: rows separated by a container-level `divide-y` (e.g. ListsPage)
// should NOT use this — the per-row border-b would double up.
export const FLAT_TABLE_ROW =
  'flex min-h-11 lg:min-h-8 items-center border-b border-gray-100'

// Explicit chevron / kebab / drag-handle target inside a row or header:
// 40px touch / 28px pointer. Compose color + hover + `shrink-0` at the call
// site. Distinct from RowIconButton, which is the compact desktop-only inline
// icon button (28x24) that never renders on mobile and so needs no touch box.
export const ROW_CONTROL_TARGET =
  'inline-flex h-10 w-10 lg:h-7 lg:w-7 items-center justify-center rounded'
