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

// ---------------------------------------------------------------------------
// Density layer
// ---------------------------------------------------------------------------
// Explicit density tokens for row/header heights, control target sizes, and
// canonical row/header padding. Composed into FLAT_TABLE_ROW / FLAT_TABLE_HEADER
// / ROW_CONTROL_TARGET below so a density tuning happens here, not in scattered
// call-site Tailwind strings. See docs/ui-density.md for the rationale.
//
// Mobile sizes are tuned for touch (44px row floor / 40px control target);
// desktop sizes shrink toward LighterPack-style density (28px row, 32px
// header, 28px control). Mobile must stay unchanged whenever desktop is
// tuned — pointer scans tolerate denser body type than touch reading.
//
// `WeightTable` remains a deliberately tighter compact-summary table and
// does NOT consume these row tokens; see docs/ui-density.md "Intentional
// exceptions".

// Row height. Mobile 44px touch target; desktop 28px scanline. Lowered from
// the previous lg:min-h-8 (32px) so the row reads at the LighterPack-ish
// density tier where the eye scans columns more than it reads sentences.
export const MOBILE_ROW_HEIGHT = 'min-h-11'
export const DESKTOP_ROW_HEIGHT = 'lg:min-h-7'

// Header height. Mobile matches the row floor; desktop 32px, intentionally
// 4px taller than the desktop row so the section divider still reads as a
// distinct strip without bulking up to a card-like band. Tightened from
// the prior 36px header in tandem with the row drop.
export const MOBILE_HEADER_HEIGHT = 'min-h-11'
export const DESKTOP_HEADER_HEIGHT = 'lg:min-h-8'

// Explicit chevron / kebab / drag-handle target box. Mobile 40px square
// (the minimum comfortable phone target); desktop 28px (exactly fills the
// new row height so a hover-revealed control doesn't push the row taller).
// Distinct from RowIconButton, the compact desktop-only inline icon button
// (28x24) that never renders on mobile and so needs no touch box.
export const MOBILE_ROW_CONTROL_TARGET = 'h-10 w-10'
export const DESKTOP_ROW_CONTROL_TARGET = 'lg:h-7 lg:w-7'

// Canonical row padding for main list/item rows. Mobile px-2 + py-2 gives
// breathing room around touch-sized controls; desktop px-3 + py-0 lets
// min-h-7 set the height and items-center handle vertical centering, so the
// row genuinely tightens to 28px on desktop instead of padding pushing it
// past min-h. Picker rows (LibraryPanel) and draft/footer rows that use a
// flush px-3 mobile pattern keep that padding inline as documented variants.
export const FLAT_TABLE_ROW_PADDING = 'px-2 lg:px-3 py-2 lg:py-0'

// Canonical header padding. Horizontal px-3 is uniform across viewports
// (touch and pointer both want some inset from the surface edge for the
// chevron/kebab targets); vertical py-0 because min-h-11 / lg:min-h-8 owns
// the height and items-center centers the title. Headers with denser
// horizontal layout (CategorySection's gap-1 px-2) or pack-mode (px-2 mobile
// ramping to px-3) keep their horizontal padding inline.
export const FLAT_TABLE_HEADER_PADDING = 'px-3 py-0'

// White table shell. The app background is gray-50, and section headers are
// gray-50 too, so a flat table needs a white surface or its headers vanish
// into the page. This is a table/list shell, NOT a decorative card: rounded
// corners + a hairline border, no shadow. overflow-hidden clips child
// row/header borders flush to the rounded container edge. The corner radius
// lives here so every flat table rounds identically — broad radius changes
// happen in one place. A surface that must be square is an explicit
// exception that overrides `rounded-none` at the call site.
export const FLAT_TABLE_SURFACE = `overflow-hidden ${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG}`

// Section / category header: a flat divider strip, not a card. Heights flow
// from the density tokens above. Compose gap + horizontal padding (or
// FLAT_TABLE_HEADER_PADDING for the canonical pattern) + `w-full` where the
// header is a flex child that must fill its track.
export const FLAT_TABLE_HEADER =
  `flex ${MOBILE_HEADER_HEIGHT} ${DESKTOP_HEADER_HEIGHT} items-center ${TABLE_HEADER_BG} border-b ${TABLE_DIVIDER}`

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

// Item / list row: a table row, not a mini card. Heights flow from the
// density tokens above (44px touch floor, 28px desktop). The bottom border
// does the separation. Compose gap / padding (or FLAT_TABLE_ROW_PADDING for
// the canonical pattern) / hover / selected-tint / bg-white at the call site.
// NOTE: rows separated by a container-level `divide-y` (e.g. ListsPage)
// should NOT use this — the per-row border-b would double up. Those rows
// should still consume MOBILE_ROW_HEIGHT / DESKTOP_ROW_HEIGHT directly so
// they track density changes.
export const FLAT_TABLE_ROW =
  `flex ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} items-center border-b ${TABLE_DIVIDER}`

// Explicit chevron / kebab / drag-handle target inside a row or header.
// Heights flow from the density tokens above (40px touch, 28px pointer).
// Compose color + hover + `shrink-0` at the call site.
export const ROW_CONTROL_TARGET =
  `inline-flex ${MOBILE_ROW_CONTROL_TARGET} ${DESKTOP_ROW_CONTROL_TARGET} items-center justify-center rounded`

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

// Quantity cells are numeric, but not weight/value displays. Keep tabular
// digits for alignment, but keep the proportional UI font so quantities
// don't read like measurement data.
export const FLAT_TABLE_QUANTITY_TEXT = 'text-xs lg:text-[13px] tabular-nums'

// Numeric value cells on rows (weight / cost / purchase date right
// rails). font-mono + tabular-nums so mixed weight strings like
// "1 lb 4.0 oz", "15.2 oz", and "800 g" line up across rows in the same
// column. font-mono is applied to value DISPLAYS only — do NOT use this
// token on labels, item names, category names, descriptions, notes,
// action buttons, or panel labels. Mono glyphs render optically larger than
// the system sans face, so value displays stay at text-xs on desktop instead
// of joining the 13px body tier.
export const FLAT_TABLE_NUMERIC_TEXT = 'text-xs font-mono tabular-nums'

// Compact stat panel body text (WeightTable cells). Denser than flat
// row body text on mobile because these panels are summary surfaces,
// not list rows. Desktop aligns to the shared 13px tier so summary
// panels read at the same body scale as the rows they summarize.
export const COMPACT_PANEL_BODY_TEXT = 'text-xs lg:text-[13px]'

// Stat panel value typography (WeightSummary stat values and similar
// emphasis values inside compact panels). Medium weight + font-mono +
// tabular-nums so the three-stat strip (Base / Consumable / Pack total)
// reads as a column of aligned weight values, not body text. Call sites
// add the color (most use text-gray-900 to anchor the value). Like
// FLAT_TABLE_NUMERIC_TEXT, this is for value displays only — never apply
// to surrounding labels (which use FLAT_TABLE_EYEBROW).
export const COMPACT_PANEL_META_TEXT = 'text-xs font-medium font-mono tabular-nums'

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
