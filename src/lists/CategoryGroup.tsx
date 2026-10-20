import { memo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react'
// Type-only: erases at build time, so the share view's bundle is unaffected.
import type { FoodItemResponse } from '../../shared/food'
import type { ListItemWithGear } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import type { ListItemPatch } from '../lib/queries'
import type { WeightUnit } from '../lib/weight'
import { useIsPrinting } from '../lib/use-is-printing'
import {
  COL_ICON,
  COL_QTY,
  COL_QTY_EDIT,
  COL_QTY_MOBILE,
  COL_WEIGHT,
  COL_WEIGHT_MOBILE,
  DESKTOP_ROW_HEIGHT,
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_HEADER_TITLE_MUTED,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_SURFACE,
  MOBILE_ROW_HEIGHT,
  PRINT_UNTRUNCATE,
  ROW_LEADING_CONTROL_TARGET,
} from '../components/flat-table-styles'
import ItemRow, { type ItemRowProps } from './ItemRow'
import { isOrdinarySectionRow, passesPackFilters } from './section-rows'
import FoodRow from './FoodRow'
import AddItemRow from './AddItemRow'
import { type AddItemData } from './use-quick-add-form'
import TotalWeightValue from '../components/TotalWeightValue'
import PackModeCheckbox from './PackModeCheckbox'
import { ConsumableIcon, WornIcon } from './list-item-flags'

// Single source of truth for a category section. Used by both the
// authenticated list detail view and the public share view.
//
// Column widths (header / footer / row Qty stubs) are defined here so the
// header labels, item rows, and footer totals always line up.
//
// This module must NOT import @dnd-kit, by value, ever. It renders on the
// public share view, and a read-only page has no business downloading a
// drag-and-drop library. That is why drag arrives as the `renderRows` prop
// instead of a `sortable` boolean: see SortableCategoryRows.tsx.
//
// Drag context: the authed list view uses ONE page-level <DndContext>.
// Categories themselves are NOT reorderable on /lists/:id — that's
// /gear-only — so this component never registers a category-level drop
// target. Items DO reorder within their category, via the per-category
// <SortableContext> that renderRows supplies. The share view passes neither
// `renderRows` nor `categoryId`, so no drag plumbing engages.
//
// Editing affordances are gated on which handlers are passed:
//   - renderRows         ⇒ rows render as SortableItemRow inside a per-category
//                          <SortableContext>. Without it, rows are plain
//                          ItemRow (no drag) - which is the share view.
//   - categoryId         ⇒ used for stable region ids (aria-controls) and
//                          surfacing the category context to add-item flows.
//                          null ⇒ uncategorized. undefined ⇒ share view.
//   - onAddItem          ⇒ "+ Add new item" footer button + AddItemRow draft.
//   - onDelete + onUpdate + onSaveGear* + onEditGearItem + onDeleteGearItem
//                        ⇒ forwarded per-row to ItemRow's editing affordances.
//   - collapsible        ⇒ header gets a chevron + toggle. No membership
//                          count: pack mode's packed/total is the only
//                          number the header carries.
//                          Default true (authed); share view passes false.
//   - packMode           ⇒ pack-mode header (qty-only, no weight column) +
//                          pack-mode row layout. Authed-only.
//
// THE FLAVOR MAP. One component serves six section flavors, selected by prop
// combination, because they all share the contracts that must never fork:
// the column-alignment geometry (headers, rows and footers line up because
// their width stubs are defined once, above), the React.memo prop-stability
// contract (below), the collapse region wiring, and the share-path
// no-@dnd-kit rule. A per-flavor split would re-spell those four contracts
// per file; do not split this component without an answer for each.
//
//   1. Share category    — no renderRows, no categoryId, collapsible false.
//   2. Edit category     — categoryId (null = Uncategorized), sortable rows,
//                          onAddItem footer, per-category subtotals.
//   3. Edit/share Food   — items=[] + foodRows (the read-only food channel),
//                          regionKey 'food'.
//   4. Pack location     — regionKey = the location id (via
//                          PackLocationSection), packMode, packFoodRows (the
//                          union channel), optional containerItem, and
//                          children + packProgressItems for nested bags.
//   5. Pack fallback     — packMode with categoryId while the list has no
//                          locations yet, plus a food section under
//                          regionKey 'packing-food-fallback'.
//   6. Worn              — wornSection + regionKey 'worn', no renderRows
//                          (structure actions do not apply), subtotalGrams.
//
// The sentinel rules those flavors lean on:
//   - The section's identity is `regionKey ?? categoryId ?? 'uncategorized'`.
//     Every categoryId-less section MUST pass a regionKey, or two sections
//     derive the same region id and aria-controls points two chevrons at one
//     target.
//   - categoryId has three states: a string is a real category, null is
//     Uncategorized, undefined means "not a category section at all"
//     (location, share, food, worn) - empty-section copy branches on it.
//   - containerItem swaps the whole section header for the backing item's
//     checklist row and joins the header's packed count.
//   - children (nested bags) REQUIRES packProgressItems - the discriminated
//     pair below - so a parent's count covers everything inside its region.
//   - foodRows and packFoodRows are deliberately separate channels: the
//     share DTO cannot satisfy the pack shape, and one prop switched on
//     packMode would let the wrong one through silently.
//
// Adding a flavor: give its discriminating prop ONE meaning, pass a
// regionKey, and extend this map.
// The props a row needs, minus the three the sortable wrapper supplies itself.
// Exported so SortableCategoryRows can spread rowPropsFor's output into
// SortableItemRow without either side re-deriving the shape.
export type RowProps = Omit<ItemRowProps, 'dragHandle' | 'outerRef' | 'outerStyle'>

/**
 * Which section is rendering, for injected renderers that need to label or
 * identify it. Plain data: the seam stays something the bundler can see
 * through, which is what keeps @dnd-kit off the public share path.
 *
 * `name` labels controls for a screen reader ("...at the end of Main pack").
 * `key` is the section's IDENTITY - the packing location id, or the sentinel
 * for the Unassigned and Worn buckets. Reorder mode binds to it so a row that
 * gets rehomed mid-placement (moved from another tab, or orphaned into
 * Unassigned when its location is deleted) ends the mode instead of quietly
 * continuing against a different bag's cohort.
 */
export type SectionIdentity = { key: string; name: string }

/** Props for one pack-mode food row - built here (plain data + handlers, no
 *  @dnd-kit) and rendered by the injected union renderRows, which wraps them
 *  in SortableFoodRow on the authenticated side. */
export type PackFoodRowProps = {
  food: FoodItemResponse
  reorderPending: boolean
  weightUnit: WeightUnit
  onUpdate: (patch: { isPacked?: boolean; isReady?: boolean }) => void
  rowAction?: ReactNode
}

/** What a read-only food row needs, and nothing more. Structural rather than
 *  a Pick of FoodItemResponse so the public share - whose DTO deliberately
 *  carries no packing state or slot ids - can satisfy it without pretending
 *  to hold fields it does not. */
export type PlainFoodRow = {
  id: string
  name: string
  // What you CARRY. Per-meal items multiply their quantity by the meals they
  // are scheduled into (0024), and this row shows the result - the pack list
  // has to say five packets when you are carrying five.
  unitCount: number
  weightGrams: number
}

export type RenderRows = (
  items: ListItemWithGear[],
  rowPropsFor: (item: ListItemWithGear) => RowProps,
  section: SectionIdentity,
  /** Pack mode only (0022): this section's food rows plus their per-row
   *  props builder. The injected renderer merges them with the gear rows
   *  into union display order; plain (share/edit) rendering never sees
   *  food. */
  packFood?: {
    rows: FoodItemResponse[]
    rowPropsFor: (food: FoodItemResponse) => PackFoodRowProps
  },
) => ReactNode

type GroupPropsBase = {
  name: string
  items: ListItemWithGear[]
  /** The gear item represented by an item-backed packing location. In pack
   *  mode it becomes the section header checklist row instead of also
   *  rendering as an ordinary item in its parent location. */
  containerItem?: ListItemWithGear | null
  weightUnit: WeightUnit
  // Page-level breakpoint: <1024 px (Tailwind `lg:` boundary). Drilled down
  // to ItemRow so a long list registers one matchMedia subscription instead
  // of one per row. Optional for callers (e.g. SharePage) that don't yet
  // pass it; defaults to false (desktop layout) until they're wired.
  isBelowLg?: boolean
  packMode?: boolean
  collapsible?: boolean
  /** Stable region id derivation + add-item context. null = uncategorized.
   *  undefined disables the chevron/region-id behavior (share view). */
  categoryId?: string | null
  /** Overrides the categoryId-derived region id for sections that have no
   *  category of their own. Required by the trailing Worn pseudo-section:
   *  it passes no categoryId, so without this it derives the SAME
   *  `cat-region-uncategorized` id as the real Uncategorized section, and
   *  whenever both render the two collapse chevrons point their
   *  aria-controls at one duplicated id. */
  regionKey?: string
  /** Supply the DRAG rendering for this category's rows. Absent (the share
   *  view) means plain, non-draggable rows.
   *
   *  This is injected rather than switched on a `sortable` boolean because a
   *  boolean cannot hide an import: branching on one still requires this module
   *  to import @dnd-kit, and this module renders on the public share view. A
   *  prop is a seam the BUNDLER can see through - pass sortableRows from
   *  SortableCategoryRows.tsx (the authenticated list view does) and the drag
   *  machinery lands in the authenticated chunk instead of the anonymous one. */
  renderRows?: RenderRows
  /** When true, the page-level reorder mutation is in flight; passed through
   *  to each SortableItemRow as `disabled` to prevent overlapping reorders
   *  from racing. Sortable-only; share view doesn't set this. */
  reorderPending?: boolean
  /** Pack mode filters: hide already-packed / already-ready items from the
   *  rendered list. Independent of each other - a row renders only if it
   *  passes BOTH - because "what's left to pack" and "what's left to prep"
   *  are different questions and a packer asks them separately. Header counts
   *  and the "complete" affordance still reflect the full items array.
   *  Authed pack-mode only; share view never sets these.
   *
   *  Neither filter touches `containerItem`. That row is the section's
   *  HEADER, not a member of it: hiding it would take the location, its
   *  contents, its actions and its droppable surface with it. A packed
   *  container therefore stays on screen while its filtered-out contents
   *  disappear, which is the intended reading - the container is still where
   *  the remaining work lives. */
  showUnpackedOnly?: boolean
  showUnreadyOnly?: boolean
  /** Header chrome, INJECTED as ReactNode rather than built here.
   *
   *  Pack mode is now also the organizer: a packing-location section can be
   *  dragged to reorder, dropped into, renamed and deleted. All of that needs
   *  @dnd-kit and authenticated-only components, and this module renders on
   *  the PUBLIC share view - so it arrives as opaque nodes, the same seam
   *  `renderRows` uses. A prop is something the bundler can see through; a
   *  boolean would not be.
   *
   *  headerLeading sits before the collapse chevron (the drag grip).
   *  headerAction sits at the end of the header row (nest handle, kebab). */
  headerLeading?: ReactNode
  headerAction?: ReactNode
  /** Replaces the rendered title text. `name` is still required and still
   *  supplies every accessible label ("Collapse {name}"), so a section stays
   *  announceable whatever its title becomes.
   *
   *  Two callers: pack mode's rename-in-place on a packing location, and the
   *  Category arrangement's Food section, which pairs the name with a link
   *  out to the Food view. The second is why this slot is worth preferring
   *  over `headerAction` for anything with width: it sits inside the header's
   *  flex-1 region, so it costs the fixed Qty/Weight column stubs nothing,
   *  while an appended action shifts both labels off the cells below them.
   *
   *  Only rendered on the COLLAPSIBLE branch. `collapsible={false}` (the
   *  public share) falls through to plain `name`. */
  titleContent?: ReactNode
  /** Per-row trailing control, same injection rationale as the header slots.
   *  Pack rows use it for the "move to location" menu, which is the
   *  keyboard- and touch-reachable equivalent of dragging a row between
   *  sections. Called per rendered row.
   *
   *  `cohort` is the rows this section actually rendered, AFTER filtering -
   *  the same array the reorder slots work against. The menu needs it to know
   *  whether reordering this row could change anything: in a section showing
   *  one row there is nowhere to put it, and offering the action anyway opens
   *  a mode with no controls in it. Passing the array rather than a boolean
   *  keeps the decision with the caller, which is the side that knows what
   *  reorder means. */
  renderRowAction?: (
    item: ListItemWithGear,
    cohort: ListItemWithGear[],
    section: SectionIdentity,
    /** Rendered gear + food rows in this section. The row menu withholds
     *  click-to-place when fewer than two rows are visible, and with food in
     *  the bag the gear cohort alone under-counts. */
    unionRowCount?: number,
  ) => ReactNode
  /** Pack-mode only (0022): this section's food rows. Food is filtered by the
   *  same pack filters as gear, counted into the header progress, and handed
   *  to renderRows for union-ordered rendering. */
  packFoodRows?: FoodItemResponse[]
  /** The non-pack counterpart: plain read-only food rows, rendered after this
   *  section's gear rows. Used by the Category arrangement and the public
   *  share, which both show food as items rather than as a checklist.
   *
   *  A SEPARATE prop from packFoodRows rather than one prop switched on
   *  packMode, because the two differ in what they need and where they go.
   *  These rows need only a name, a quantity and a weight, and render
   *  directly as FoodRow. Pack rows need the mutable packing state on top of
   *  that and must travel through the injected renderRows seam so @dnd-kit
   *  stays out of the anonymous share bundle - the same seam gear rows use.
   *  Collapsing them would mean either importing the drag machinery here or
   *  demanding pack state from a surface that has none. */
  foodRows?: PlainFoodRow[]
  onUpdateFood?: (
    foodId: string,
    patch: { isPacked?: boolean; isReady?: boolean },
  ) => void
  renderFoodRowAction?: (
    food: FoodItemResponse,
    unionRowCount: number,
    section: SectionIdentity,
  ) => ReactNode
  /** The one section allowed to render worn rows. Every ordinary category or
   *  packing-location section filters them into the trailing Worn section. */
  wornSection?: boolean
  /** Footer totals for this section, supplied by the parent.
   *
   *  Deliberately NOT computed here. This section used to sum its own rows,
   *  which put consumable and worn weight into the subtotal, so the subtotals never summed to
   *  the summary panel's Base weight, and flipping an unrelated display toggle
   *  silently changed what the number meant. The parents already hold the
   *  canonical computeListWeightBreakdown result; they pass the answers down
   *  (see baseGramsForCategory and consumableGramsForCategory) so there is one
   *  definition of each weight bucket.
   *
   *  Passed as PRIMITIVES, deliberately, not as `{label, grams}` objects.
   *  object. This component is memo'd and its call sites go to real lengths to
   *  keep every prop reference stable (see useGroupedListItems, sharedGroupProps,
   *  useStableWornItems). An object literal in JSX is freshly allocated on every
   *  parent render, so it would fail the shallow compare and re-render every
   *  section on unrelated list mutations - including in pack mode, where the
   *  subtotal is not rendered at all.
   *
   *  Category footers render each positive bucket with its label. Zero-value
   *  buckets are omitted instead of showing Base 0 or Consumable 0. The Worn
   *  pseudo-section keeps the legacy `subtotalGrams` input but labels its
   *  canonical list-level total explicitly in the footer. */
  baseSubtotalGrams?: number
  consumableSubtotalGrams?: number
  subtotalGrams?: number
  onUpdate?: (itemId: string, patch: ListItemPatch) => void
  onDelete?: (itemId: string) => void
  onSaveGearName?: (gearItemId: string, name: string) => void
  onSaveGearDescription?: (gearItemId: string, description: string) => void
  onSaveGearWeight?: (gearItemId: string, weightGrams: number) => void
  // categoryId flows in from the component's own `categoryId` prop so the
  // parent can pass a single stable useCallback'd handler for both the
  // categorized and uncategorized call sites. Previously this was
  // `(data) => void` and required per-call-site inline arrows that
  // currying the categoryId — those fresh closures defeated React.memo's
  // shallow compare every render. null = uncategorized.
  onAddItem?: (categoryId: string | null, data: AddItemData) => void
  // Kebab handlers receive the gear item's id; the parent resolves to a full
  // GearItem from its gearItems query before opening dialogs.
  onEditGearItem?: (gearItemId: string) => void
  onDeleteGearItem?: (gearItemId: string) => void
  onSetGearStatus?: (gearItemId: string, status: GearStatus) => void
}

/** Nested item-backed location sections stay injected so this public-share
 * component does not import authenticated tree machinery. When nested content
 * is present, its complete checklist membership is required too: the parent
 * header must count everything rendered inside its collapsible region. */
type GroupContentProps =
  | {
      children?: undefined
      packProgressItems?: never
    }
  | {
      children: ReactNode
      packProgressItems: ListItemWithGear[]
    }

export type GroupProps = GroupPropsBase & GroupContentProps

// Wrapped in React.memo (default shallow compare) at the export below.
// Phase 5 Commit 1 introduced structural per-group stability in
// groupListItemsByCategory — the `items` prop reference is now reused
// across mutations whose render-affecting fields didn't change. Without
// the stability layer this memo would be defeated; with it, unchanged
// categories skip their re-render entirely on pack-mode toggles.
//
// Prop stability requirements at the call site (see ListDetailPage.tsx):
// - onAddItem widened to (categoryId, data) so the parent passes a single
//   useCallback'd handler instead of per-call-site curried arrows.
// - All other props are stable from prior phases (sharedGroupProps memo,
//   useGroupedListItems hook, primitives).
function CategoryGroup({
  name,
  items,
  containerItem,
  children,
  packProgressItems,
  weightUnit,
  isBelowLg = false,
  packMode = false,
  collapsible = true,
  categoryId,
  regionKey,
  renderRows,
  reorderPending = false,
  showUnpackedOnly = false,
  showUnreadyOnly = false,
  headerLeading,
  headerAction,
  titleContent,
  renderRowAction,
  packFoodRows,
  foodRows,
  onUpdateFood,
  renderFoodRowAction,
  wornSection = false,
  baseSubtotalGrams,
  consumableSubtotalGrams,
  subtotalGrams,
  onUpdate,
  onDelete,
  onSaveGearName,
  onSaveGearDescription,
  onSaveGearWeight,
  onAddItem,
  onEditGearItem,
  onDeleteGearItem,
  onSetGearStatus,
}: GroupProps) {
  // `adding` drives the desktop inline AddItemRow. Mobile no longer
  // exposes a per-category "Add new item" footer — the single mobile add
  // path is the top-bar "Add" button, which opens the gear picker drawer
  // over existing inventory. New gear is created from the Gear page.
  const [adding, setAdding] = useState(false)
  const [localCollapsed, setLocalCollapsed] = useState(false)
  // A collapsed section removes its body from the DOM (see `!collapsed` at the
  // rows below), so - exactly like pack's row filters - no print stylesheet
  // can bring those rows back, and the printed sheet would be short of gear
  // with nothing on the paper to say so. Pack is the worst case: it renders no
  // collapse control at all, so a section collapsed in List view and carried
  // into Pack cannot even be reopened.
  //
  // Overriding the DERIVED value rather than the stored one leaves the local
  // state untouched, so the screen is exactly as the user left it once the
  // print ends.
  const isPrinting = useIsPrinting()
  const collapsed = isPrinting ? false : localCollapsed
  function toggleCollapsed() {
    setLocalCollapsed(!collapsed)
  }
  // Stable id for the collapsible region so the header button can announce
  // aria-controls. Category sections derive it from categoryId; sections with
  // no category of their own (the Worn pseudo-section) pass an explicit
  // regionKey, because categoryId-less sections would otherwise all collapse
  // onto the same 'uncategorized' id and duplicate it in the document.
  const sectionKey = regionKey ?? categoryId ?? 'uncategorized'
  const regionId = `cat-region-${sectionKey}`
  const section: SectionIdentity = { key: sectionKey, name }
  // sectionItems = the items that BELONG to this category section. Worn
  // items always belong to the trailing Worn section, so ordinary sections
  // exclude them from the pack count, footer totals, and rows - by the one
  // shared rule in section-rows.ts, which the reorder planner uses too. The
  // Worn section opts into its own rows explicitly.
  const sectionItems = wornSection ? items : items.filter(isOrdinarySectionRow)
  // Only displayed in pack-mode header. Gating the read on packMode means
  // the share view (which never enters pack mode) doesn't pull is_packed
  // off each item; that field is excluded from the public read path.
  const progressItems = packProgressItems
    ?? (containerItem ? [containerItem, ...sectionItems] : sectionItems)
  // Food counts into the header progress exactly like gear (0022: the
  // section's contents are the union). Full arrays, not filtered ones -
  // header counts always reflect everything the section holds.
  const sectionFood = packFoodRows ?? []
  const packedCount = packMode
    ? progressItems.filter((i) => i.isPacked).length +
      sectionFood.filter((f) => f.isPacked).length
    : 0
  const progressTotal = progressItems.length + sectionFood.length
  const showKebabSlot = !packMode && Boolean(onDelete)
  // "Complete" = pack mode, has contents, every one of them packed.
  const complete = packMode && progressTotal > 0 && packedCount === progressTotal
  // Filters hide finished rows from the rendered list. Applied AFTER the
  // section split so packed-but-worn items don't sneak through.
  //
  // The two filters are ANDed, not ORed: with both on you see only rows that
  // are neither packed nor ready - the rows with everything still to do. OR
  // would make turning on a second filter show MORE rows, which is not what a
  // filter switch means.
  // Copy for a genuinely empty pack section, and it has to name the right
  // thing. Pack groups by packing location, but falls back to CATEGORY
  // grouping while a list has no locations (selectPackGrouping), so "no items
  // in this location" would be describing a category - and a category can go
  // empty for a mundane reason, e.g. everything in it is worn and has moved
  // to the trailing Worn section.
  //
  // Location sections pass a regionKey and no categoryId; category sections
  // pass a categoryId (null for Uncategorized). Unassigned is the odd one
  // out both ways: "no items here" frames a fully organized list as a
  // problem, when an empty Unassigned bucket is exactly what finishing looks
  // like.
  const emptySectionLabel = regionKey === 'packing-unassigned'
    ? 'Everything has a location.'
    : categoryId === undefined
      ? 'No items in this location.'
      : 'No items in this category.'
  const filtering = packMode && (showUnpackedOnly || showUnreadyOnly)
  const visibleItems = filtering
    ? sectionItems.filter((i) => passesPackFilters(i, { showUnpackedOnly, showUnreadyOnly }))
    : sectionItems
  // Same shared predicate, applied to the food half of the union.
  const visibleFood = filtering
    ? sectionFood.filter((f) => passesPackFilters(f, { showUnpackedOnly, showUnreadyOnly }))
    : sectionFood
  const unionRowCount = visibleItems.length + visibleFood.length

  // Per-row props builder — same shape for SortableItemRow and ItemRow.
  // reorderPending is read by SortableItemRow's useSortable (`disabled`);
  // ItemRow ignores it since plain rows aren't draggable to begin with.
  function rowPropsFor(item: ListItemWithGear) {
    const gearId = item.gearItem.id
    return {
      item,
      weightUnit,
      isBelowLg,
      packMode,
      reorderPending,
      onUpdate: onUpdate ? (patch: ListItemPatch) => onUpdate(item.id, patch) : undefined,
      onSaveName: onSaveGearName ? (n: string) => onSaveGearName(gearId, n) : undefined,
      onSaveDescription: onSaveGearDescription ? (d: string) => onSaveGearDescription(gearId, d) : undefined,
      onSaveWeight: onSaveGearWeight ? (w: number) => onSaveGearWeight(gearId, w) : undefined,
      onEditGearItem: onEditGearItem ? () => onEditGearItem(gearId) : undefined,
      onDeleteGearItem: onDeleteGearItem ? () => onDeleteGearItem(gearId) : undefined,
      onSetGearStatus: onSetGearStatus ? (s: GearStatus) => onSetGearStatus(gearId, s) : undefined,
      onDelete: onDelete ? () => onDelete(item.id) : undefined,
      rowAction: renderRowAction?.(item, visibleItems, section, unionRowCount),
    }
  }

  return (
    // Each category renders as its own flat-table card (FLAT_TABLE_SURFACE);
    // the page composes gaps between cards. The picker is the deliberate
    // exception — it stays one continuous surface to avoid nested cards.
    <div className={FLAT_TABLE_SURFACE}>
      {/* Header — also functions as the column header for Weight / Qty.
          In pack mode the header tightens on mobile so the Qty label stays
          aligned over the (newly tightened) pack-mode row's qty column.
          Height comes from FLAT_TABLE_HEADER (mobile 44px touch floor /
          desktop 32px scanline, sourced from MOBILE_HEADER_HEIGHT and
          DESKTOP_HEADER_HEIGHT in flat-table-styles.ts), so a density
          retune flows through the token. The chevron (authed) or the
          min-height alone (share view, no chevron) fills it. */}
      <div className={`${FLAT_TABLE_HEADER} ${
        // Non-pack uses FLAT_TABLE_HEADER_PADDING's canonical px-3 py-0; pack
        // mode tightens to px-2 on mobile (extra column slots squeeze the
        // header and need every spare pixel) and ramps to px-3 on desktop
        // alongside the canonical horizontal padding.
        // Pack's horizontal padding and gaps are hand-rolled here rather
        // than taken from FLAT_TABLE_HEADER_PADDING, so the print tier has
        // to be spelled out alongside them or the header keeps screen
        // padding while its rows tighten.
        packMode
          ? 'gap-0.5 lg:gap-1.5 print:gap-1 px-2 lg:px-3 print:px-1 py-0'
          : `gap-1.5 print:gap-1 ${FLAT_TABLE_HEADER_PADDING}`
      } ${
        // Collapsed: the header is the card's only child, so its divider
        // border-b would double with the card's bottom border. Drop it.
        collapsed ? 'border-b-0' : ''
      }`}>
        {headerLeading}
        {collapsible ? (
          // print:gap-1 matches the ROW's outer gap. A row's Ready checkbox and
          // its Packed label are siblings one level up, spaced by that outer
          // gap; here they sit inside this group instead, so without the match
          // a container header's Packed square and name print 2px right of the
          // ones in every row beneath it. Alignment down the checkbox columns
          // is the whole point of a printed checklist.
          <div className="flex flex-1 min-w-0 items-center gap-1.5 print:gap-1">
            {/* Chevron is the only interactive collapse target. Mobile mistaps
                (tapping near the first row but landing on the header) used to
                collapse the whole section because the entire header strip was
                one button. Splitting into chevron-button + static label moves
                that risk to a 40px-square explicit affordance.

                NOT in pack mode. Pack's header carries the container's Ready
                and Packed checkboxes, and those have to sit in the same
                columns as every row's below them. A chevron ahead of them
                occupies the rows' leading control column - the drag grip's
                column - and pushes the header's checkboxes one control to the
                right of the ones they label. Alignment down the checkbox
                columns is the whole point of a checklist, so the collapse
                affordance loses. */}
            {!packMode && (
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
                aria-controls={regionId}
                aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
                className={`${ROW_LEADING_CONTROL_TARGET} text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0 print:hidden`}
              >
                {collapsed ? (
                  <ChevronRight size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </button>
            )}
            {packMode && containerItem ? (
              <>
                <PackModeCheckbox
                  variant="ready"
                  checked={containerItem.isReady}
                  onChange={(checked) => onUpdate?.(containerItem.id, { isReady: checked })}
                  ariaLabel={`Mark ${containerItem.gearItem.name} ready`}
                  title="Ready"
                  standaloneLabel
                />
                <span
                  aria-hidden="true"
                  className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
                />
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                  <PackModeCheckbox
                    variant="packed"
                    checked={containerItem.isPacked}
                    onChange={(checked) => onUpdate?.(containerItem.id, { isPacked: checked })}
                  />
                  <span
                    aria-hidden="true"
                    className="hidden print:inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-gray-900"
                  />
                  <span className={`truncate ${PRINT_UNTRUNCATE} ${
                    containerItem.isPacked
                      ? `${FLAT_TABLE_HEADER_TITLE_MUTED} line-through print:text-gray-900 print:no-underline`
                      : FLAT_TABLE_HEADER_TITLE
                  }`}>
                    {containerItem.gearItem.name}
                  </span>
                </label>
              </>
            ) : (
              /* Static label area - explicitly NOT a button, no hover state.
                 Chevron is the obvious affordance; the name remains
                 read-only here (rename happens via the section menu or the
                 modal, not by tapping the header). titleContent is the one
                 override: a packing location being renamed in place, and the
                 Category arrangement's Food section, which pairs the name
                 with a link out to the Food view. See the prop's doc for why
                 anything with width belongs here rather than in
                 headerAction. */
              titleContent ?? (
                <span className={`truncate ${PRINT_UNTRUNCATE} ${complete ? FLAT_TABLE_HEADER_TITLE_MUTED : FLAT_TABLE_HEADER_TITLE}`}>{name}</span>
              )
            )}
            {complete && (
              <Check size={14} className="shrink-0 text-green-600 print:hidden" aria-label="All packed" />
            )}
          </div>
        ) : (
          <span className={`flex-1 min-w-0 truncate ${FLAT_TABLE_HEADER_TITLE}`}>{name}</span>
        )}
        {!packMode ? (
          <>
            {/* Desktop column-stubs (≥ lg) — align with desktop ItemRow's
                worn/consumable/qty/weight/kebab columns. */}
            <div className="hidden lg:contents">
              <div className={COL_ICON} />
              <div className={COL_ICON} />
              <div className={`${COL_QTY_EDIT} text-right ${FLAT_TABLE_EYEBROW}`}>
                Qty
              </div>
              <div className={`${COL_WEIGHT} text-right ${FLAT_TABLE_EYEBROW}`}>
                Weight
              </div>
              {showKebabSlot && <div className={COL_ICON} />}
            </div>
            {/* Mobile column-stubs (< lg) — single w/c slot, narrower qty
                and weight columns matching MobileRowBody. No kebab stub. */}
            <div className="lg:hidden flex items-center gap-2">
              <div className={COL_ICON} />
              <div className={`${COL_QTY_MOBILE} text-right ${FLAT_TABLE_EYEBROW}`}>
                Qty
              </div>
              <div className={`${COL_WEIGHT_MOBILE} text-right ${FLAT_TABLE_EYEBROW}`}>
                Weight
              </div>
            </div>
          </>
        ) : containerItem ? (
          <>
            <span className={`${COL_ICON} inline-flex items-center justify-center`}>
              {containerItem.isWorn && <WornIcon />}
            </span>
            <span className={`${COL_ICON} inline-flex items-center justify-center`}>
              {containerItem.isConsumable && <ConsumableIcon />}
            </span>
            <span className={`${COL_QTY} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500`}>
              {containerItem.quantity}
            </span>
          </>
        ) : (
          <>
            <div className={COL_ICON} />
            <div className={COL_ICON} />
            <div className={`${COL_QTY} text-right ${FLAT_TABLE_EYEBROW}`}>
              Qty
            </div>
          </>
        )}
        {headerAction}
      </div>

      {/* Items + footer (footer is the row's "total" line, lined up under Weight) */}
      {!collapsed && (
        // The id exists solely as the chevron's aria-controls target, so it is
        // emitted only when the chevron is. The share view passes
        // collapsible={false} AND no categoryId for any section, so without
        // this gate every section there (plus Worn) rendered the same
        // `cat-region-uncategorized` id - duplicate ids on the public page,
        // referenced by nothing.
        <div id={collapsible ? regionId : undefined}>
          {/* Plain food rows follow this section's gear rows. Non-pack only:
              in pack mode food is part of the union cohort and comes through
              renderRows with the gear, so rendering it here as well would
              show every row twice. */}
          {renderRows
            ? renderRows(
                visibleItems,
                rowPropsFor,
                section,
                packMode && packFoodRows !== undefined
                  ? {
                      rows: visibleFood,
                      rowPropsFor: (food: FoodItemResponse) => ({
                        food,
                        reorderPending,
                        // Required, not optional: a food row without the
                        // unit would format grams against a different scale
                        // than the gear row beside it in the same bag.
                        weightUnit,
                        onUpdate: (patch: { isPacked?: boolean; isReady?: boolean }) =>
                          onUpdateFood?.(food.id, patch),
                        rowAction: renderFoodRowAction?.(food, unionRowCount, section),
                      }),
                    }
                  : undefined,
              )
            : visibleItems.map((item) => <ItemRow key={item.id} {...rowPropsFor(item)} />)}
          {!packMode &&
            foodRows?.map((food) => (
              <FoodRow
                key={food.id}
                food={food}
                weightUnit={weightUnit}
                isBelowLg={isBelowLg}
              />
            ))}
          {/* An empty pack section says WHY it is empty. Without this a
              section can render as a bare header with nothing under it, and
              the two reasons look identical: the location genuinely holds
              nothing, or a filter is hiding everything in it. The second is
              the dangerous one - a packer scanning for what is left could
              read a filtered-empty section as "done here". (The retired
              Organize view carried this line; the filters make it matter
              more, not less.) Only pack sections: an empty CATEGORY in edit
              mode is self-evident from the add-item row beneath it. */}
          {packMode && unionRowCount === 0 && !children && (
            <p className="px-3 py-3 text-sm text-gray-500 print:px-1 print:py-0.5 print:text-[10px]">
              {sectionItems.length + sectionFood.length === 0
                ? emptySectionLabel
                : `All ${sectionItems.length + sectionFood.length} ${sectionItems.length + sectionFood.length === 1 ? 'item' : 'items'} here are hidden by the filters above.`}
            </p>
          )}
          {children}

          {/* Draft row when adding — full editable item row */}
          {!packMode && onAddItem && adding && (
            <AddItemRow
              onSubmit={(data) => { onAddItem(categoryId ?? null, data); setAdding(false) }}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Footer row — "+ Add new item" on the left at lg+, category
              total on the right. The whole row is hidden on mobile screens
              (max-lg): it adds a per-section gap that breaks the flat table
              rhythm, and the mobile UI already surfaces totals in the
              top-bar summary. Kept for desktop (quick-add + subtotal) and
              for print (print:flex), where the per-category total is part
              of the paper checklist. The button stays desktop-only since
              mobile uses the top-bar "Add" + picker drawer flow. Column
              stubs branch on viewport to keep the total's right edge aligned
              with the Weight column while giving compound lb+oz values room
              to extend left into the empty Qty rail. */}
          {!packMode && !adding && (
            // Matches FLAT_TABLE_ROW density via the shared height tokens so
            // this footer row tracks any future density change automatically;
            // can't use FLAT_TABLE_ROW directly because the row is display-
            // gated (hidden lg:flex print:flex) and carries no bottom border.
            <div className={`hidden lg:flex print:flex ${MOBILE_ROW_HEIGHT} ${DESKTOP_ROW_HEIGHT} items-center gap-1.5 px-3 py-0 ${FLAT_TABLE_BODY_TEXT}`}>
              {onAddItem ? (
                <button
                  onClick={() => setAdding(true)}
                  className="hidden lg:flex flex-1 min-w-0 items-center gap-1 text-left text-gray-500 hover:text-blue-600"
                >
                  <Plus size={12} /> Add new item
                </button>
              ) : null}
              <div className={`flex-1 min-w-0 ${onAddItem ? 'lg:hidden' : ''}`} />
              <div className="hidden lg:contents">
                <div className={COL_ICON} />
                <div className={COL_ICON} />
                <div className="shrink-0 min-w-[9.375rem] text-right text-gray-700">
                  <CategoryFooterWeights
                    baseGrams={baseSubtotalGrams}
                    consumableGrams={consumableSubtotalGrams}
                    wornGrams={subtotalGrams}
                    weightUnit={weightUnit}
                  />
                </div>
                {showKebabSlot && <div className={COL_ICON} />}
              </div>
              <div className="lg:hidden flex items-center gap-2">
                <div className={COL_ICON} />
                <div className="shrink-0 min-w-[7.5rem] text-right text-gray-700">
                  <CategoryFooterWeights
                    baseGrams={baseSubtotalGrams}
                    consumableGrams={consumableSubtotalGrams}
                    wornGrams={subtotalGrams}
                    weightUnit={weightUnit}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

function CategoryFooterWeights({
  baseGrams,
  consumableGrams,
  wornGrams,
  weightUnit,
}: {
  baseGrams?: number
  consumableGrams?: number
  wornGrams?: number
  weightUnit: WeightUnit
}) {
  if (wornGrams !== undefined) {
    return (
      <CategoryFooterMetric label="Worn" grams={wornGrams} weightUnit={weightUnit} />
    )
  }

  const totals = [
    baseGrams !== undefined && baseGrams > 0
      ? { label: 'Base', grams: baseGrams }
      : null,
    consumableGrams !== undefined && consumableGrams > 0
      ? { label: 'Consumable', grams: consumableGrams }
      : null,
  ].filter((total): total is { label: string; grams: number } => total !== null)

  return (
    <span className="inline-flex flex-nowrap items-baseline justify-end gap-x-3">
      {totals.map((total) => (
        <CategoryFooterMetric
          key={total.label}
          label={total.label}
          grams={total.grams}
          weightUnit={weightUnit}
        />
      ))}
    </span>
  )
}

function CategoryFooterMetric({
  label,
  grams,
  weightUnit,
}: {
  label: string
  grams: number
  weightUnit: WeightUnit
}) {
  // Keep label and value in one fixed line box. Applying numeric typography
  // to the outer footer cell makes the label inherit monospace, while the
  // responsive meta token bumps only the label to 13px on desktop. That
  // combination looks vertically staggered even when flex baselines agree.
  return (
    <span className="whitespace-nowrap text-xs leading-4">
      <span className="font-sans font-normal text-gray-500">{label}</span>{' '}
      <span className={`${FLAT_TABLE_NUMERIC_TEXT} leading-4 font-semibold text-gray-700`}>
        <CategoryFooterWeightValue grams={grams} weightUnit={weightUnit} />
      </span>
    </span>
  )
}

function CategoryFooterWeightValue({
  grams,
  weightUnit,
}: {
  grams: number
  weightUnit: WeightUnit
}) {
  // Category gram totals are display-rounded only. Ounce output still converts
  // the full aggregate so changing units does not compound the rounding.
  const displayGrams = weightUnit === 'g' ? Math.round(grams) : grams
  return <TotalWeightValue grams={displayGrams} unit={weightUnit} />
}

export default memo(CategoryGroup)
