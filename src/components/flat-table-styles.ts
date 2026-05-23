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
  'text-xs font-semibold uppercase tracking-wider text-gray-500'

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

// ---------------------------------------------------------------------------
// Body typography tokens
// ---------------------------------------------------------------------------
// Centralized so desktop/mobile font-size experiments happen in one place
// instead of being chased across call sites. Heading-and-label typography
// is the existing FLAT_TABLE_HEADER_TITLE / FLAT_TABLE_EYEBROW pair above;
// the tokens here cover row body content, compact panels, and markdown notes.
//
// Desktop scale: 13px (lg:text-[13px]). This is a deliberate tier below
// Tailwind's text-sm (14px) and above text-xs (12px), giving denser desktop
// scans without the eye-strain of text-xs. The arbitrary-value class is
// safe for Tailwind v4's JIT scanner — the literal appears statically in
// this file so the class lands in the generated CSS. The shared 13px scale
// raises some compact text-xs surfaces (META / NUMERIC / COMPACT_PANEL_BODY)
// up to 13px on desktop AND brings text-sm body surfaces down to 13px, so
// the row body and its numeric chips read at the same size — a single
// desktop body tier instead of the previous 12 / 14 split.
//
// Mobile stays at text-sm (14px) / text-xs (12px) unchanged. The shared
// 13px tier is desktop-only because pointer scans tolerate denser body
// type than touch reading.
//
// Out of scope (intentional): modal titles, primary CTAs, auth pages, and
// other surfaces that are not row/table/panel chrome. Strings used only
// once anywhere in the codebase also stay inline — these tokens exist for
// repeated patterns, not for every literal text-* class.

// Body text on flat row surfaces. Used by ItemRow / GearItemRow /
// LibraryPanel rows / CategoryGroup footer / AddItemRow / CategorySection
// rename + empty states. Call sites compose `font-normal` or other
// weights + color separately when needed.
export const FLAT_TABLE_BODY_TEXT = 'text-sm lg:text-[13px]'

// Muted body variant for descriptions and secondary copy on rows. The
// `font-normal text-gray-500` treatment is the established pattern for
// item/gear descriptions in the share/owner read paths; kept as one
// token so descriptions don't drift in weight or color. Rows that flip
// the color reactively (e.g. ItemRow's is_packed strikethrough) keep
// the inline color override and compose FLAT_TABLE_BODY_TEXT + font-normal
// instead.
export const FLAT_TABLE_BODY_TEXT_MUTED = 'text-sm lg:text-[13px] font-normal text-gray-500'

// Compact metadata text. Used for small qty/weight chips and tiny labels
// inside rows where the chip would otherwise overpower the body text on
// mobile. Desktop bumps to 13px so meta and body read at the same scale
// for column-aligned scanning.
export const FLAT_TABLE_META_TEXT = 'text-xs lg:text-[13px]'

// Tabular-nums variant of FLAT_TABLE_META_TEXT for column-aligned numeric
// chips on rows (qty / weight right rails). Same size scale as META_TEXT;
// kept as a separate token because future tuning of numeric vs text
// metadata might diverge.
export const FLAT_TABLE_NUMERIC_TEXT = 'text-xs lg:text-[13px] tabular-nums'

// Compact stat panel body text (WeightTable cells). Denser than flat
// row body text on mobile because these panels are summary surfaces,
// not list rows. Desktop aligns to the shared 13px tier so summary
// panels read at the same body scale as the rows they summarize.
export const COMPACT_PANEL_BODY_TEXT = 'text-xs lg:text-[13px]'

// Stat panel value typography (WeightSummary stat values and similar
// emphasis values inside compact panels). Medium weight + tabular-nums
// so values read as numbers, not body text. Call sites add the color
// (most use text-gray-900 to anchor the value).
export const COMPACT_PANEL_META_TEXT = 'text-sm lg:text-[13px] font-medium tabular-nums'

// Markdown notes body text (p, ul, ol, blockquote inside MarkdownContent).
// Desktop matches the shared 13px body tier so notes read at the same
// scale as the surrounding row/table surfaces; mobile stays at text-sm
// for comfortable reading width.
export const MARKDOWN_COMPACT_BODY_TEXT = 'text-sm lg:text-[13px]'

// Markdown notes heading typography (h2, h3 inside MarkdownContent).
// Same size as the body on desktop (13px), differentiated by font-semibold
// weight. h1 stays inline at the call site (text-base) because it's the
// only site at that size and is the one heading meant to read as larger
// than body within compact notes.
export const MARKDOWN_COMPACT_HEADING_TEXT = 'text-sm lg:text-[13px] font-semibold'

// ---------------------------------------------------------------------------
// Panel control typography tokens
// ---------------------------------------------------------------------------
// Settings/control panel surfaces are conceptually distinct from flat row
// surfaces (the row tokens above target list-detail / gear / picker / share
// row chrome). The two tokens here cover the repeated patterns that live
// inside panel-shaped surfaces (PrivacyPanel, ListSettingsPanel,
// PackingProgress, NotesEditor, SharePage's notes block).

// Panel toggle label. The text label sitting next to a ToggleSwitch inside
// a control panel. Canonical color is text-gray-900 so active setting/
// control labels read as primary panel content; helper/descriptive copy
// next to them stays lighter. Earlier `PackingProgress` carried gray-700
// for the same role; that drift is intentionally resolved to gray-900 here.
// Desktop matches the shared 13px tier with the rest of panel body text.
export const PANEL_TOGGLE_LABEL = 'text-sm lg:text-[13px] font-medium text-gray-900'

// Panel empty-state placeholder. "No notes" / similar empty content shown
// inside a notes-style panel surface (NotesEditor read state, SharePage
// notes block). Italic + light gray so the placeholder reads as absent
// content rather than active text. Distinct from row empty states
// ("No items" in a category) which use FLAT_TABLE_BODY_TEXT + the row
// surface's italic + color: the row pattern is one site (CategorySection)
// and stays composed inline.
export const PANEL_EMPTY_TEXT = 'text-sm lg:text-[13px] italic text-gray-400'
