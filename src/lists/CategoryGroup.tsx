import { memo, useState } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import type { ListItemWithGear } from '../lib/types'
import type { ListItemPatch } from '../lib/queries'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import { makeDnDId } from '../lib/dnd-ids'
import ItemRow, { SortableItemRow } from './ItemRow'
import AddItemRow, { type AddItemData } from './AddItemRow'

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
  collapsible = true,
  categoryId,
  sortable = false,
  reorderPending = false,
  showUnpackedOnly = false,
  hideWorn = false,
  onUpdate,
  onDelete,
  onSaveGearName,
  onSaveGearDescription,
  onSaveGearWeight,
  onAddItem,
  onEditGearItem,
  onDeleteGearItem,
}: GroupProps) {
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Stable id for the collapsible region so the header button can announce
  // aria-controls. categoryId is always set when collapsible=true (share view
  // passes collapsible=false and the button isn't rendered there).
  const regionId = `cat-region-${categoryId ?? 'uncategorized'}`
  // sectionItems = the items that BELONG to this category section. When
  // hideWorn is on (pack mode + Group Worn), worn items belong to the
  // trailing Worn section instead, so they're excluded here for header
  // counts AND the visible row list. Without this split, a category would
  // show "2 / 5" while only 3 non-worn rows render, and an all-worn
  // category would show counts even though every row moved away.
  const sectionItems = hideWorn ? items.filter((i) => !i.is_worn) : items
  // Only displayed in pack-mode header. Gating the read on packMode means
  // the share view (which never enters pack mode) doesn't pull is_packed
  // off each item; that field is excluded from the public read path.
  const packedCount = packMode ? sectionItems.filter((i) => i.is_packed).length : 0
  // totalGrams is shown only in the !packMode footer (and hideWorn is
  // packMode-only), so the full items array is the right input here.
  const totalGrams = items.reduce((s, i) => s + i.gear_item.weight_grams * i.quantity, 0)
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
      reorderPending,
      onUpdate: onUpdate ? (patch: ListItemPatch) => onUpdate(item.id, patch) : undefined,
      onSaveName: onSaveGearName ? (n: string) => onSaveGearName(gearId, n) : undefined,
      onSaveDescription: onSaveGearDescription ? (d: string) => onSaveGearDescription(gearId, d) : undefined,
      onSaveWeight: onSaveGearWeight ? (w: number) => onSaveGearWeight(gearId, w) : undefined,
      onEditGearItem: onEditGearItem ? () => onEditGearItem(gearId) : undefined,
      onDeleteGearItem: onDeleteGearItem ? () => onDeleteGearItem(gearId) : undefined,
      onDelete: onDelete ? () => onDelete(item.id) : undefined,
    }
  }

  return (
    <div>
      {/* Header — also functions as the column header for Weight / Qty.
          In pack mode the header tightens on mobile so the Qty label stays
          aligned over the (newly tightened) pack-mode row's qty column. */}
      <div className={`flex items-center rounded-lg py-0.5 bg-gray-100 mb-1 ${
        packMode ? 'gap-0.5 lg:gap-1.5 px-2 lg:px-3' : 'gap-1.5 px-3'
      }`}>
        {collapsible ? (
          <button
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-controls={regionId}
            className="flex flex-1 min-w-0 items-center gap-1.5 text-left"
          >
            {collapsed ? (
              <ChevronRight size={14} className="text-gray-400 shrink-0" />
            ) : (
              <ChevronDown size={14} className="text-gray-400 shrink-0" />
            )}
            <span className={`truncate text-sm font-medium ${complete ? 'text-gray-400' : 'text-gray-700'}`}>{name}</span>
            <span className="shrink-0 text-xs tabular-nums text-gray-400">
              {packMode ? `${packedCount} / ${sectionItems.length}` : `(${items.length})`}
            </span>
            {complete && (
              <Check size={14} className="shrink-0 text-green-600" aria-label="All packed" />
            )}
          </button>
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
        <div id={regionId} className="pl-2">
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

          {/* Footer row — "+ Add new item" on the left (only when authed),
              category total on the right. Column stubs branch on viewport
              to keep the total aligned under the Weight column. */}
          {!packMode && !adding && (
            <div className="flex items-center gap-1.5 px-3 py-0.5 text-sm">
              {onAddItem ? (
                <button
                  onClick={() => setAdding(true)}
                  className="flex flex-1 min-w-0 items-center gap-1 text-left text-gray-400 hover:text-blue-600"
                >
                  <Plus size={12} /> Add new item
                </button>
              ) : (
                <div className="flex-1 min-w-0" />
              )}
              <div className="hidden lg:contents">
                <div className="shrink-0 w-7" />
                <div className="shrink-0 w-7" />
                <div className="shrink-0 w-12" />
                <div className="shrink-0 w-24 text-right tabular-nums font-semibold text-gray-700">
                  {items.length > 0 ? formatItemWeight(totalGrams, weightUnit) : ''}
                </div>
                {showKebabSlot && <div className="shrink-0 w-7" />}
              </div>
              <div className="lg:hidden flex items-center gap-2">
                <div className="shrink-0 w-6" />
                <div className="shrink-0 w-8" />
                <div className="shrink-0 w-20 text-right tabular-nums font-semibold text-gray-700">
                  {items.length > 0 ? formatItemWeight(totalGrams, weightUnit) : ''}
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
