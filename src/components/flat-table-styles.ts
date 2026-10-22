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
// desktop sizes shrink toward Lighterpack-style density (28px row, 32px
// header, 28px control). Mobile must stay unchanged whenever desktop is
// tuned - pointer scans tolerate denser body type than touch reading.
//
// `WeightTable` remains a deliberately tighter compact-summary table and
// does NOT consume these row tokens; see docs/ui-density.md "Intentional
// exceptions".

// ---------------------------------------------------------------------------
// Print tier
// ---------------------------------------------------------------------------
// A THIRD density tier, for paper. It moves neither screen tier.
//
// The reason it has to exist: `lg:` is `min-width: 1024px`, and a browser
// evaluates print media queries against the PAGE BOX, not the screen. US
// Letter portrait is ~816 CSS px wide, so `lg:` NEVER matches while printing
// and every sheet would otherwise go out in the 44px touch tier - the phone
// layout, on paper. That is not a hypothetical: it is what printing a list
// did before this tier existed.
//
// Paper needs no touch targets and resolves far finer than a screen, so this
// tier is denser than either screen tier: no minimum height (a row is as tall
// as its content), no vertical padding, 10px body text.
//
// Print also hides every interactive control (see RowIconButton and
// POPOVER_SURFACE below). That is what actually shrinks a row - min-height
// does not cap CONTENT height, and a visible 40px drag grip holds a row at
// 40px however low the min-height goes.
export const PRINT_ROW_HEIGHT = 'print:min-h-0'
export const PRINT_ROW_PADDING = 'print:px-1 print:py-0'
export const PRINT_BODY_TEXT = 'print:text-[10px]'

// Undo `truncate` on paper. A screen truncates because horizontal space is
// fixed and a scroll gesture is cheap; paper has neither property, and an
// ellipsized item name on a checklist is silently missing information. Rows
// wrap instead, which is why the print tier sets no minimum height.
//
// `overflow-wrap: anywhere` is the part that is easy to leave out and wrong to
// leave out: normal wrapping only breaks at existing whitespace, and gear
// names allow 256 characters, so one unbroken name would run out of its cell
// and across the quantity rail - visibly, because this same token turns
// clipping off. Written as an arbitrary property so it does not depend on
// which Tailwind version named the shorthand.
export const PRINT_UNTRUNCATE =
  'print:overflow-visible print:text-clip print:whitespace-normal print:[overflow-wrap:anywhere]'

// Fragmentation hints. `break-*-avoid` asks the browser not to split a row
// across a page and not to strand a section heading at the foot of one. It
// ASKS: the spec lets a browser relax avoidance to make progress, so neither
// is a guarantee and neither has been verified against real pagination.
//
// Whole SECTIONS are deliberately NOT protected: nested bags are descendants
// of their parent section, so blanket avoidance would ask the browser to keep
// an entire bag subtree together - which wastes the bottom of pages and has to
// fail anyway once a group exceeds one page.
export const PRINT_KEEP_TOGETHER = 'print:break-inside-avoid'
export const PRINT_KEEP_WITH_NEXT = 'print:break-after-avoid'

// Row height. Mobile 44px touch target; desktop 28px scanline. Lowered from
// the previous lg:min-h-8 (32px) so the row reads at the Lighterpack-ish
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
// (the minimum comfortable phone target); desktop 28px TALL (exactly fills
// the row height so a hover-revealed control doesn't push the row taller)
// and 24px WIDE.
//
// 24 is deliberate: WCAG 2.2 SC 2.5.8 (Target Size (Minimum), Level AA) sets
// a 24x24 CSS px floor for pointer targets, and this is that floor.
//
// Be precise about what that does and does not buy. 2.5.8 asks the target to
// CONTAIN a 24x24 square, and `rounded` clips the corners - so a nominal
// 24x24 box does not strictly satisfy the size requirement on its own, and
// these controls still lean on the spacing exception the same way the
// narrower leading column below does. What 24 buys is margin: the smaller the
// nominal box, the more of the argument rests on gaps that move whenever the
// surrounding layout is touched.
//
// It was 28, which spent 4px on that margin without reaching independence
// either, and left a 14px glyph visibly rattling around inside its target on
// every row.
//
// Height is free here: 28px is the desktop row height, so filling it costs no
// vertical space. Only the width comes in, which is the axis wasting room.
//
// The width must stay equal to RowIconButton's compact width - a section
// header leads with one and an item row leads with the other, and equal
// widths are what keep their columns aligned.
export const MOBILE_ROW_CONTROL_TARGET = 'h-10 w-10'
export const DESKTOP_ROW_CONTROL_TARGET = 'lg:h-7 lg:w-6'
// Same targets as MINIMA, for controls that size to their CONTENT rather than
// to a fixed icon box - a quantity label that may be one digit or four, and
// the number input it becomes. Same numbers as above on purpose: a control is
// a control, and the density doc's two tiers do not fork per widget.
//
// Written out as literal class tokens rather than derived from the pair above
// with .replace(). Tailwind v4 scans whole tokens in the SOURCE, so a class
// name assembled at runtime produces no CSS at all - the control would come
// out with no target and the bug would be invisible in review.
export const MOBILE_ROW_CONTROL_MIN_TARGET = 'min-h-10 min-w-10'
export const DESKTOP_ROW_CONTROL_MIN_TARGET = 'lg:min-h-7 lg:min-w-6'

// The LEADING control column - narrower on desktop than the square target
// above, and only on desktop.
//
// Two controls share this slot and must stay the same width: a section
// header's collapse chevron and a row's drag grip. They sit in the same
// column, ahead of the same gap, so the header title and the item names line
// up only while the two boxes agree. They have drifted before (see the
// comment in gear/CategorySection.tsx about the grip that used to lead the
// header), which is why this is ONE token rather than two that happen to
// match - a single width cannot fall out of sync with itself.
//
// 28px was right when the slot held a chevron alone, but GripVertical draws
// two thin columns of dots about 6px wide, so a 28px box leaves ~11px of
// visible dead space either side and the row gains a wide empty gutter before
// its first real content. 20px still clears WCAG 2.5.8 via the spacing
// exception (the gap to the next control exceeds the 24px circle overlap),
// and a 14px chevron keeps 3px of breathing room inside it. Height stays 28px
// (it is the desktop row height, so vertical size is free); only the width
// comes in, which is the axis actually wasting space.
//
// Mobile is untouched at 40x40 - the density doc's standing rule is that
// tuning desktop must never move touch sizing, and a grip is exactly the kind
// of control a thumb needs room for.
export const DESKTOP_ROW_LEADING_TARGET = 'lg:h-7 lg:w-5'

// Canonical row padding for main list/item rows. Mobile px-2 + py-2 gives
// breathing room around touch-sized controls; desktop px-3 + py-0 lets
// min-h-7 set the height and items-center handle vertical centering, so the
// row genuinely tightens to 28px on desktop instead of padding pushing it
// past min-h. Picker rows (LibraryPanel) and draft/footer rows that use a
// flush px-3 mobile pattern keep that padding inline as documented variants.
export const FLAT_TABLE_ROW_PADDING = `px-2 lg:px-3 py-2 lg:py-0 ${PRINT_ROW_PADDING}`

// Canonical header padding. Horizontal px-3 is uniform across viewports
// (touch and pointer both want some inset from the surface edge for the
// chevron/kebab targets); vertical py-0 because min-h-11 / lg:min-h-8 owns
// the height and items-center centers the title. Headers with denser
// horizontal layout - pack-mode (px-2 mobile ramping to px-3) - keep their
// horizontal padding inline. CategorySection USED to be such an exception
// (gap-1 px-2, to make room for a leading category grip); it now consumes
// this token, which is what puts its chevron, title, and trailing rail on
// GearItemRow's own coordinates. See docs/ui-density.md "Reserved space".
export const FLAT_TABLE_HEADER_PADDING = `px-3 py-0 ${PRINT_ROW_PADDING}`

// White table shell. The app background is gray-50, and section headers are
// gray-50 too, so a flat table needs a white surface or its headers vanish
// into the page. This is a table/list shell, NOT a decorative card: rounded
// corners + a hairline border, no shadow. overflow-hidden clips child
// row/header borders flush to the rounded container edge. The corner radius
// lives here so every flat table rounds identically — broad radius changes
// happen in one place. A surface that must be square is an explicit
// exception that overrides `rounded-none` at the call site.
// print:overflow-visible: the clip that rounds corners on screen would also
// clip a wrapped name and fight page fragmentation, and a hairline radius
// buys nothing on paper.
export const FLAT_TABLE_SURFACE =
  `overflow-hidden print:overflow-visible ${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG}`

// Section / category header: a flat divider strip, not a card. Heights flow
// from the density tokens above. Compose gap + horizontal padding (or
// FLAT_TABLE_HEADER_PADDING for the canonical pattern) + `w-full` where the
// header is a flex child that must fill its track.
export const FLAT_TABLE_HEADER =
  `flex ${MOBILE_HEADER_HEIGHT} ${DESKTOP_HEADER_HEIGHT} ${PRINT_ROW_HEIGHT} ${PRINT_KEEP_WITH_NEXT} items-center ${TABLE_HEADER_BG} border-b ${TABLE_DIVIDER}`

// Header/label typography. Two tiers:
//   - TITLE: the one prominent section heading (category names). Preserves
//     user-entered capitalization, so it is never uppercased.
//   - EYEBROW: every small uppercase micro-label — in-table column labels
//     (Qty / Weight / Price / Purchased), summary stat labels (Base /
//     Consumable), panel titles (Notes / Weight summary), and disclosure
//     toggles. One token so these don't drift apart in size/case/color.
export const FLAT_TABLE_HEADER_TITLE = `text-sm font-medium text-gray-700 ${PRINT_BODY_TEXT}`
export const FLAT_TABLE_HEADER_TITLE_MUTED = `text-sm font-medium text-gray-500 ${PRINT_BODY_TEXT}`
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
  `flex ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} ${PRINT_ROW_HEIGHT} ${PRINT_KEEP_TOGETHER} items-center border-b ${TABLE_DIVIDER}`

// Explicit kebab / toggle target inside a row or header. Heights flow from
// the density tokens above (40px touch, 28x24 pointer). Compose color + hover
// + `shrink-0` at the call site.
export const ROW_CONTROL_TARGET =
  `inline-flex ${MOBILE_ROW_CONTROL_TARGET} ${DESKTOP_ROW_CONTROL_TARGET} items-center justify-center rounded`

// Same box, narrowed on desktop, for the LEADING column only: a header's
// collapse chevron and a row's drag grip. Both, or they fall out of column.
// See DESKTOP_ROW_LEADING_TARGET.
export const ROW_LEADING_CONTROL_TARGET =
  `inline-flex ${MOBILE_ROW_CONTROL_TARGET} ${DESKTOP_ROW_LEADING_TARGET} items-center justify-center rounded`

// ---------------------------------------------------------------------------
// Column-width tokens
// ---------------------------------------------------------------------------
// A section header's label stubs must sit exactly above the row cells below
// them, so header and row compose the SAME width token - a hand-mirrored
// width is how the two drift. Width + shrink only; alignment and typography
// compose at the call site. One token per COLUMN, not per width: Price and
// the mobile weight both happen to be w-20 today, but they are different
// columns that may diverge.
export const COL_ICON = 'shrink-0 w-6' // worn/consumable/kebab slot
export const COL_QTY = 'shrink-0 w-10' // pack-row quantity
export const COL_QTY_EDIT = 'shrink-0 w-12' // edit-row InlineQuantity
export const COL_QTY_MOBILE = 'shrink-0 w-8'
export const COL_WEIGHT = 'shrink-0 w-24' // desktop weight cell
export const COL_WEIGHT_MOBILE = 'shrink-0 w-20'
export const COL_PRICE = 'shrink-0 w-20' // gear table price
export const COL_DATE = 'shrink-0 w-24' // gear table purchase date

// Desktop-only hover reveal for a row control (drag grips): invisible until
// the row (`group`) is hovered or the control itself is keyboard-focused.
// Call sites pass '' instead below lg - a touch viewport has no hover to
// reveal with, so the control must stay visible.
export const ROW_HOVER_REVEAL =
  'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity'

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
export const FLAT_TABLE_BODY_TEXT = `text-sm lg:text-[13px] ${PRINT_BODY_TEXT}`

// Muted body variant for descriptions and secondary copy on rows. The
// `font-normal text-gray-500` treatment is the established pattern for
// item/gear descriptions in the share/owner read paths; kept as one
// token so descriptions don't drift in weight or color. Rows that flip
// the color reactively (e.g. ItemRow's is_packed strikethrough) keep
// the inline color override and compose FLAT_TABLE_BODY_TEXT + font-normal
// instead.
export const FLAT_TABLE_BODY_TEXT_MUTED =
  `text-sm lg:text-[13px] font-normal text-gray-500 ${PRINT_BODY_TEXT}`

// Focus indicator for active inline-edit controls. These controls already use
// a blue border to mean "editing", so keyboard focus needs a separate ring.
export const INLINE_EDIT_FOCUS_RING =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1'

// Compact metadata text. Used for small qty/weight chips and tiny labels
// inside rows where the chip would otherwise overpower the body text on
// mobile. Desktop bumps to 13px so meta and body read at the same scale
// for column-aligned scanning.
export const FLAT_TABLE_META_TEXT = 'text-xs lg:text-[13px]'

// Quantity cells are numeric, but not weight/value displays. Keep tabular
// digits for alignment, but keep the proportional UI font so quantities
// don't read like measurement data.
export const FLAT_TABLE_QUANTITY_TEXT = `text-xs lg:text-[13px] tabular-nums ${PRINT_BODY_TEXT}`

// Size-neutral numeric value treatment. Compose this when a value display
// already owns a deliberate size tier.
// Keeping size out of this token lets migrations add mono alignment without
// flattening the existing visual hierarchy.
export const NUMERIC_VALUE_TEXT = 'font-mono tabular-nums'

// Numeric value cells on dense rows (weight / cost / purchase date right
// rails). font-mono + tabular-nums so mixed weight strings like
// "1 lb 4.0 oz", "15.2 oz", and "800 g" line up across rows in the same
// column. font-mono is applied to value DISPLAYS only — do NOT use this
// token on labels, item names, category names, descriptions, notes,
// action buttons, or panel labels. Mono glyphs render optically larger than
// the system sans face, so value displays stay at text-xs on desktop instead
// of joining the 13px body tier.
export const FLAT_TABLE_NUMERIC_TEXT = `text-xs ${NUMERIC_VALUE_TEXT}`

// The weight cell on a Pack row, for gear and food rows alike. One bag holds
// both, so a cell that differs on one of them pushes every column to its
// right out of line. lg+ only: a w-24 cell at 375px would crush the name.
// Hidden in print, where the checklist keeps its own geometry.
export const PACK_ROW_WEIGHT_CELL = `hidden lg:inline-block ${COL_WEIGHT} text-gray-500 print:hidden`

// The shared shell of a NON-pack item row (gear library and list detail).
// px-3 mobile is intentional (not the canonical px-2 mobile ramp) - these
// rows have fewer columns than pack mode and read better with a uniform
// inset. lg:py-0 lets min-h-7 (28px) own the height on desktop so the
// density tier actually applies. In the mobile-swipe case the padding and
// background move onto the swipe foreground so the revealed action reaches
// the row edge, and the shell keeps only its separator border.
export function itemRowShell(mobileSwipe: boolean): string {
  return `group relative ${FLAT_TABLE_ROW} ${FLAT_TABLE_BODY_TEXT} ${
    mobileSwipe ? '' : 'gap-1.5 bg-white px-3 py-2 lg:py-0'
  }`
}

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
export const PANEL_EMPTY_TEXT = 'text-sm lg:text-[13px] italic text-gray-500'

// ---------------------------------------------------------------------------
// Form field tokens
// ---------------------------------------------------------------------------
// The canonical text/number/select field: rounded-lg shell, gray hairline,
// comfortable py-2 target, blue focus ring. This exact string was repeated
// as a literal across every dialog form (GearItemDialog, QuickAddItemModal,
// ListsEmptyState, ...) before it was hoisted here; new forms should compose
// this token instead of re-typing it. Call sites add width (`w-full`),
// alignment (`text-right tabular-nums`), and shape extras (`resize-none`,
// `appearance-none`) around it. Fields with asymmetric padding (e.g. the
// price input's `pl-6` currency inset) stay inline as documented variants.
// Labels belong to the FormLabel component, not a token here.
export const FORM_INPUT =
  'rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

// The secondary action beside a PrimaryButton (Cancel and its siblings in
// dialog footers). Same box as PrimaryButton's md size; quiet gray chrome.
export const SECONDARY_BUTTON =
  'rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100'

// ---------------------------------------------------------------------------
// Popover surface
// ---------------------------------------------------------------------------
// Floating popover/menu chrome: rounded card with a hairline border, white
// fill, and a soft drop shadow. Used by every kebab/portal menu, the
// MobileMenu trigger menu, and the List options / Gear options popovers.
//
// Deliberately NOT folded into FLAT_TABLE_SURFACE — popovers are different
// chrome (fixed/floating, shadowed, no overflow-hidden clipping). Both the
// table surface AND the popover surface share the border tone + radius +
// fill so the global chrome language stays unified, but they vary on
// shadow + clipping intentionally. See docs/ui-density.md "Popover surface".
//
// Call sites compose this with `fixed z-50 w-XX` and a body padding
// (`py-1` for menu-row popovers; `p-2` / `p-3` for embedded-panel popovers
// like List options).
// print:hidden is load-bearing and belongs HERE rather than at the 10 render
// sites: every one of these menus portals to document.body, so hiding the
// trigger - or any ancestor of it - cannot hide the menu. The surface token
// is the one thing they all share.
export const POPOVER_SURFACE =
  `${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} shadow-lg print:hidden`
