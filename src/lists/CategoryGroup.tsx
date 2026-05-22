import { memo, useState } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import type { ListItemPatch } from '../lib/queries'
import { formatTotalWeight, type WeightUnit } from '../lib/weight'
import { makeDnDId } from '../lib/dnd-ids'
import ItemRow, { SortableItemRow } from './ItemRow'
import AddItemRow from './AddItemRow'
import { type AddItemData } from './use-quick-add-form'

// Single source of truth for a category section. Used by both the
// authenticated list detail view and the public share view.
//
// Column widths (header / footer / row Qty stubs) are defined here so the
// header labels, item rows, and footer totals always line up.
//
// Drag context: the authed list view uses ONE page-level <DndContext>.
// Categories themselves are NOT reorderable on /lists/:id — that's
// /gear-only — so this component never registers a category-level drop
// target. Items DO reorder within their category: we render a per-category
// <SortableContext> around the rows below, so each row's useSortable
// resolves against its category's items list. The share view passes
// neither `sortable` nor `categoryId`, so no drag plumbing engages.
//
// Editing affordances are gated on which handlers are passed:
//   - sortable           ⇒ rows render as SortableItemRow inside a per-category
//                          <SortableContext> wired up here. Without it, rows
//                          are plain ItemRow (no drag).
//   - categoryId         ⇒ used for stable region ids (aria-controls) and
//                          surfacing the category context to add-item flows.
//                          null ⇒ uncategorized. undefined ⇒ share view.
//   - onAddItem          ⇒ "+ Add new item" footer button + AddItemRow draft.
//   - onDelete + onUpdate + onSaveGear* + onEditGearItem + onDeleteGearItem
//                        ⇒ forwarded per-row to ItemRow's editing affordances.
//   - collapsible        ⇒ header gets a chevron + count badge + toggle.
//                          Default true (authed); share view passes false.
//   - packMode           ⇒ pack-mode header (qty-only, no weight column) +
//                          pack-mode row layout. Authed-only.
export type GroupProps = {
  name: string
  items: ListItemWithGear[]
  weightUnit: WeightUnit
  // Page-level breakpoint: <1024 px (Tailwind `lg:` boundary). Drilled down
  // to ItemRow so a long list registers one matchMedia subscription instead
  // of one per row. Optional for callers (e.g. SharePage) that don't yet
  // pass it; defaults to false (desktop layout) until they're wired.
  isBelowLg?: boolean
  packMode?: boolean
  /** Pack-mode-only: when true, ItemRow renders a Ready checkbox before the
   *  Packed checkbox. Owner toggles this from PackingProgress; share view and
   *  edit-mode pages don't pass it. */
  readyChecksEnabled?: boolean
  collapsible?: boolean
  /** Stable region id derivation + add-item context. null = uncategorized.
   *  undefined disables the chevron/region-id behavior (share view). */
  categoryId?: string | null
  /** Render rows as SortableItemRow (must be inside a page-level SortableContext). */
  sortable?: boolean
  /** When true, the page-level reorder mutation is in flight; passed through
   *  to each SortableItemRow as `disabled` to prevent overlapping reorders
   *  from racing. Sortable-only; share view doesn't set this. */
  reorderPending?: boolean
  /** Pack mode filter: when true, hide already-packed items from the rendered
   *  list. Header counts and the "complete" affordance still reflect the full
   *  items array. Authed pack-mode only; share view never sets this. */
  showUnpackedOnly?: boolean
  /** Pack mode + Group Worn: hide is_worn items from this category's render
   *  (they appear in the trailing Worn section instead). Same shape as
   *  showUnpackedOnly — filter at the leaf so the parent doesn't have to
   *  produce a fresh items array per group every time the toggle flips,
   *  which would defeat React.memo's shallow compare. */
  hideWorn?: boolean
  /** Pack-mode write-block forwarded to each ItemRow's checkbox. Set by
   *  ListDetailPage when offline so checkbox taps don't fire failing
   *  mutations. Authed pack-mode only. */
  packActionsDisabled?: boolean
  onUpdate?: (itemId: string, patch: ListItemPatch) => void
  onDelete?: (itemId: string) => void
  onSaveGearName?: (gearItemId: string, name: string) => void
  onSaveGearDescription?: (gearItemId: string, description: string) => void
  onSaveGearWeight?: (gearItemId: string, weight_grams: number) => void
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
  weightUnit,
  isBelowLg = false,
  packMode = false,
  readyChecksEnabled = false,
  collapsible = true,
  categoryId,
  sortable = false,
  reorderPending = false,
  showUnpackedOnly = false,
  hideWorn = false,
  packActionsDisabled = false,
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
  const [collapsed, setCollapsed] = useState(false)
  // Stable id for the collapsible region so the header button can announce
  // aria-controls. categoryId is always set when collapsible=true (share view
  // passes collapsible=false and the button isn't rendered there).
  const regionId = `cat-region-${categoryId ?? 'uncategorized'}`
  // sectionItems = the items that BELONG to this category section. When
  // hideWorn is on (list.group_worn enabled, in any mode including the
  // share view), worn items belong to the trailing Worn section instead,
  // so they're excluded here for header counts, footer totals, AND the
  // visible row list. Without this split, the category header would show
  // "(5)" while only 3 non-worn rows render, and the footer total would
  // include weight the user can't see in this section — double-counted
  // against the same rows showing in the trailing Worn section.
  const sectionItems = hideWorn ? items.filter((i) => !i.is_worn) : items
  // Only displayed in pack-mode header. Gating the read on packMode means
  // the share view (which never enters pack mode) doesn't pull is_packed
  // off each item; that field is excluded from the public read path.
  const packedCount = packMode ? sectionItems.filter((i) => i.is_packed).length : 0
  // Footer total (non-pack mode). Sums sectionItems so the displayed total
  // matches the visible rows when hideWorn is on. The list-level
  // WeightTable is unaffected and still reports worn weight as
  // "Worn (not added)" for the overall pack-weight summary.
  const totalGrams = sectionItems.reduce(
    (s, i) => s + i.gear_item.weight_grams * i.quantity,
    0,
  )
  const showKebabSlot = !packMode && Boolean(onDelete)
  // "Complete" = pack mode, has section items, every section item packed.
  const complete = packMode && sectionItems.length > 0 && packedCount === sectionItems.length
  // When the unpacked-only filter is on, hide packed items from the
  // rendered rows. Applied AFTER the section split so packed-but-worn
  // items don't sneak through.
  const visibleItems = packMode && showUnpackedOnly
    ? sectionItems.filter((i) => !i.is_packed)
    : sectionItems

  // Per-row props builder — same shape for SortableItemRow and ItemRow.
  // reorderPending is read by SortableItemRow's useSortable (`disabled`);
  // ItemRow ignores it since plain rows aren't draggable to begin with.
  function rowPropsFor(item: ListItemWithGear) {
    const gearId = item.gear_item.id
    return {
      item,
      weightUnit,
      isBelowLg,
      packMode,
      readyChecksEnabled,
      packActionsDisabled,
      reorderPending,
      onUpdate: onUpdate ? (patch: ListItemPatch) => onUpdate(item.id, patch) : undefined,
      onSaveName: onSaveGearName ? (n: string) => onSaveGearName(gearId, n) : undefined,
      onSaveDescription: onSaveGearDescription ? (d: string) => onSaveGearDescription(gearId, d) : undefined,
      onSaveWeight: onSaveGearWeight ? (w: number) => onSaveGearWeight(gearId, w) : undefined,
      onEditGearItem: onEditGearItem ? () => onEditGearItem(gearId) : undefined,
      onDeleteGearItem: onDeleteGearItem ? () => onDeleteGearItem(gearId) : undefined,
      onSetGearStatus: onSetGearStatus ? (s: GearStatus) => onSetGearStatus(gearId, s) : undefined,
      onDelete: onDelete ? () => onDelete(item.id) : undefined,
    }
  }

  return (
    <div>
      {/* Header — also functions as the column header for Weight / Qty.
          In pack mode the header tightens on mobile so the Qty label stays
          aligned over the (newly tightened) pack-mode row's qty column.
          min-h-11 (44px) on touch keeps headers and rows on one vertical
          rhythm; lg:min-h-9 tightens to a denser pointer scan while still
          clearing the desktop chevron/controls. The chevron (authed) or the
          min-height alone (share view, no chevron) fills it. */}
      <div className={`flex items-center py-0.5 bg-gray-50 border-b border-gray-100 min-h-11 lg:min-h-9 ${
        packMode ? 'gap-0.5 lg:gap-1.5 px-2 lg:px-3' : 'gap-1.5 px-3'
      }`}>
        {collapsible ? (
          // Chevron is the only interactive collapse target. Mobile mistaps
          // (tapping near the first row but landing on the header) used to
          // collapse the whole section because the entire header strip was
          // one button. Splitting into chevron-button + static label moves
          // that risk to a 40px-square explicit affordance.
          <div className="flex flex-1 min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
              aria-controls={regionId}
              aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
              className="inline-flex h-10 w-10 lg:h-7 lg:w-7 items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0 print:hidden"
            >
              {collapsed ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
            {/* Static label area - explicitly NOT a button, no hover state.
                Chevron is the obvious affordance; the name remains
                read-only here (rename happens via the modal, not by tapping
                the header). */}
            <span className={`truncate text-sm font-medium ${complete ? 'text-gray-400' : 'text-gray-700'}`}>{name}</span>
            <span className="shrink-0 text-xs tabular-nums text-gray-400">
              {packMode ? (
                <>
                  {/* Digital packed count is meaningless on a paper checklist
                      where every box prints empty. Show the same "(N)"
                      total as edit mode in print to keep header parity. */}
                  <span className="print:hidden">{packedCount} / {sectionItems.length}</span>
                  <span className="hidden print:inline">({sectionItems.length})</span>
                </>
              ) : (
                `(${sectionItems.length})`
              )}
            </span>
            {complete && (
              <Check size={14} className="shrink-0 text-green-600 print:hidden" aria-label="All packed" />
            )}
          </div>
        ) : (
          <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700">{name}</span>
        )}
        {!packMode ? (
          <>
            {/* Desktop column-stubs (≥ lg) — align with desktop ItemRow's
                worn/consumable/qty/weight/kebab columns. */}
            <div className="hidden lg:contents">
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-7" />
              <div className="shrink-0 w-12 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Qty
              </div>
              <div className="shrink-0 w-24 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Weight
              </div>
              {showKebabSlot && <div className="shrink-0 w-7" />}
            </div>
            {/* Mobile column-stubs (< lg) — single w/c slot, narrower qty
                and weight columns matching MobileRowBody. No kebab stub. */}
            <div className="lg:hidden flex items-center gap-2">
              <div className="shrink-0 w-6" />
              <div className="shrink-0 w-8 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Qty
              </div>
              <div className="shrink-0 w-20 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Weight
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="shrink-0 w-6 lg:w-7" />
            <div className="shrink-0 w-6 lg:w-7" />
            <div className="shrink-0 w-10 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Qty
            </div>
          </>
        )}
      </div>

      {/* Items + footer (footer is the row's "total" line, lined up under Weight) */}
      {!collapsed && (
        <div id={regionId}>
          {sortable ? (
            // Per-category SortableContext — items reorder within their own
            // category only. Item ids registered here so each row's useSortable
            // resolves to the right items list and the strategy auto-shift works.
            <SortableContext items={visibleItems.map((i) => makeDnDId('item', i.id))} strategy={verticalListSortingStrategy}>
              {visibleItems.map((item) => <SortableItemRow key={item.id} {...rowPropsFor(item)} />)}
            </SortableContext>
          ) : (
            visibleItems.map((item) => <ItemRow key={item.id} {...rowPropsFor(item)} />)
          )}

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
              stubs branch on viewport to keep the total aligned under the
              Weight column. */}
          {!packMode && !adding && (
            <div className="hidden lg:flex print:flex items-center gap-1.5 px-3 py-0.5 text-sm">
              {onAddItem ? (
                <button
                  onClick={() => setAdding(true)}
                  className="hidden lg:flex flex-1 min-w-0 items-center gap-1 text-left text-gray-400 hover:text-blue-600"
                >
                  <Plus size={12} /> Add new item
                </button>
              ) : null}
              <div className={`flex-1 min-w-0 ${onAddItem ? 'lg:hidden' : ''}`} />
              <div className="hidden lg:contents">
                <div className="shrink-0 w-7" />
                <div className="shrink-0 w-7" />
                <div className="shrink-0 w-12" />
                <div className="shrink-0 w-24 text-right tabular-nums font-semibold text-gray-700">
                  {items.length > 0 ? formatTotalWeight(totalGrams, weightUnit) : ''}
                </div>
                {showKebabSlot && <div className="shrink-0 w-7" />}
              </div>
              <div className="lg:hidden flex items-center gap-2">
                <div className="shrink-0 w-6" />
                <div className="shrink-0 w-8" />
                <div className="shrink-0 w-20 text-right tabular-nums font-semibold text-gray-700">
                  {items.length > 0 ? formatTotalWeight(totalGrams, weightUnit) : ''}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

export default memo(CategoryGroup)
