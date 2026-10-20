import { memo, type ReactNode } from 'react'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import type { GearItem } from '../lib/types'
import type { GearStatus } from '../lib/gear-status'
import type { WeightUnit } from '../lib/weight'
import { useSortableRow } from '../lib/use-sortable-row'
import ItemWeightValue from '../components/ItemWeightValue'
import InlineWeight from '../components/InlineWeight'
import KebabMenu from '../components/KebabMenu'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import SwipeableRow from '../components/SwipeableRow'
import { MobileRowBody, NameDescriptionCell } from '../components/ItemRowScaffold'
import {
  COL_DATE,
  COL_PRICE,
  COL_WEIGHT,
  COL_WEIGHT_MOBILE,
  FLAT_TABLE_NUMERIC_TEXT,
  ROW_HOVER_REVEAL,
  itemRowShell,
} from '../components/flat-table-styles'
import GearStatusMenuItems from '../components/gear/GearStatusMenuItems'

type Props = {
  item: GearItem
  weightUnit: WeightUnit
  // Page-level breakpoint: true at <1024 px (Tailwind `lg:` boundary). Drilled
  // from the page so a 500-row library registers one matchMedia subscription,
  // not 500.
  isBelowLg: boolean
  selectMode: boolean
  selected: boolean
  // Entity-aware callbacks (id / item / status are passed by the row itself,
  // not pre-bound by the parent map). This lets CategorySection forward ONE
  // stable callback identity per action to every row, so memo(SortableGearItemRow)
  // is a real barrier instead of being busted by fresh per-row closures.
  onToggleSelect: (id: string) => void
  onInlineSave: (id: string, patch: Partial<Pick<GearItem, 'name' | 'description' | 'weightGrams'>>) => void
  onEdit: (item: GearItem) => void
  onDelete: (item: GearItem) => void
  onSetStatus: (id: string, status: GearStatus) => void
  // Drag plumbing — populated by SortableGearItemRow.
  dragHandle?: ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}

export default function GearItemRow({
  item,
  weightUnit,
  isBelowLg,
  selectMode,
  selected,
  onToggleSelect,
  onInlineSave,
  onEdit,
  onDelete,
  onSetStatus,
  dragHandle,
  outerRef,
  outerStyle,
}: Props) {
  const mobileSwipe = isBelowLg && !selectMode

  // The shared badge+name body; this surface's only trailing cell is weight.
  const mobileBody = (
    <div className="flex flex-1 items-center gap-2">
      <MobileRowBody
        status={item.status}
        name={item.name}
        onTap={selectMode ? () => onToggleSelect(item.id) : () => onEdit(item)}
        tapLabel={selectMode ? (selected ? 'Deselect item' : 'Select item') : 'Edit item'}
      >
        <span className={`${COL_WEIGHT_MOBILE} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
          <ItemWeightValue grams={item.weightGrams} unit={weightUnit} />
        </span>
      </MobileRowBody>
    </div>
  )

  return (
    <div
      ref={outerRef}
      style={outerStyle}
      // The shared shell recipe (and its px-3 mobile inset rationale) lives
      // in itemRowShell; this row adds its selection tint on top.
      className={`${itemRowShell(mobileSwipe)} ${
        selected ? 'bg-blue-50' : 'hover:bg-gray-50'
      }`}
    >
      {dragHandle}
      {selectMode && (
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(item.id)}
          aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
          className="h-4 w-4 rounded border-gray-300 text-blue-600"
        />
      )}

      {isBelowLg ? (
        /* Mobile branch (< lg) — name + weight only, no description, no
           inline icon buttons. The whole row body is one tappable button:
           tap toggles selection in select mode, otherwise opens the edit
           dialog. The leading checkbox (rendered above when selectMode is
           on) is a sibling of the button, so a checkbox tap only fires
           its own onChange — no double-toggle. In normal mode, a left
           swipe reveals Delete from inventory and hands off to the same
           confirm dialog as the kebab/edit-dialog delete path. */
        mobileSwipe ? (
          <SwipeableRow
            onAction={() => onDelete(item)}
            label="Delete from inventory"
            icon={<Trash2 size={22} />}
            actionClassName="bg-red-600 text-white"
            actionArmedClassName="bg-red-600 text-white"
          >
            <div className="flex flex-1 items-center gap-1.5 px-3 py-2">
              {mobileBody}
            </div>
          </SwipeableRow>
        ) : (
          <div className="flex flex-1 items-center gap-1.5">
            {mobileBody}
          </div>
        )
      ) : (
        /* Desktop branch (≥ lg) — name + description (2:3 cols), weight,
           and a kebab menu for Edit / Delete actions. The kebab pattern
           mirrors the list page's RowKebab so both pages share one row-
           action affordance. Hidden in select mode (selection itself
           replaces per-row actions). */
        <>
          {/* The ''->null conversion in onSaveDescription: clearing the
              field is how a description is removed, and the write contract
              takes null, never ''. */}
          <NameDescriptionCell
            status={item.status}
            name={item.name}
            description={item.description ?? ''}
            onSaveName={(v) => onInlineSave(item.id, { name: v })}
            onSaveDescription={(v) => onInlineSave(item.id, { description: v || null })}
            showDescription={item.description !== null || !selectMode}
          />
          <span className={`${COL_PRICE} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500`}>
            {formatCost(item.cost)}
          </span>
          <span className={`${COL_DATE} text-right ${FLAT_TABLE_NUMERIC_TEXT} text-gray-500`}>
            {formatPurchaseDate(item.purchaseDate)}
          </span>
          {/* The same control the list rows use. This page could only edit a
              weight through the dialog, while a list row edited it in place -
              the two surfaces had drifted apart for no reason beyond which PR
              built them. Select mode drops to static: the row's affordances
              belong to the selection while it is on. */}
          <InlineWeight
            grams={item.weightGrams}
            unit={weightUnit}
            onSave={selectMode ? undefined : (w) => onInlineSave(item.id, { weightGrams: w })}
            itemName={item.name}
            className={`${COL_WEIGHT} text-gray-600`}
          />
          {!selectMode && (
            <GearRowKebab
              status={item.status}
              onEdit={() => onEdit(item)}
              onDelete={() => onDelete(item)}
              onSetStatus={(s) => onSetStatus(item.id, s)}
            />
          )}
        </>
      )}
    </div>
  )
}

// Cost is currency, formatted with commas + two decimals. Null renders
// as "--", never $0.00: unknown is unknown. en-US locale matches
// our USD-only treatment (see GearItem.cost docstring).
const COST_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})
function formatCost(cost: number | null): string {
  if (cost === null) return '--'
  return COST_FORMATTER.format(cost)
}

// purchaseDate arrives as ISO YYYY-MM-DD. Parsing as 'YYYY-MM-DDT00:00:00'
// keeps it in local-time so a 2024-04-15 entry doesn't render as Apr 14
// for users west of UTC. Output uses the user's locale via undefined-locale
// for readability ("Apr 15, 2024" in en-US).
//
// Hoisted because GearLibraryPage renders one cell per gear row;
// constructing a fresh Intl.DateTimeFormat per row was the audit-caught
// L9 cost. Locale is read once at module load — virtually no SPA
// respects mid-session locale changes anyway and we're not localizing
// anything else.
const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
function formatPurchaseDate(date: string | null): string {
  if (date === null) return '--'
  const d = new Date(`${date}T00:00:00`)
  if (isNaN(d.getTime())) return '--'
  return DATE_FORMATTER.format(d)
}

// Row kebab — Edit (opens GearItemDialog), quick status, Delete from
// inventory (red, opens the confirm dialog). Mirrors `RowKebab` on the list
// page (src/lists/ItemRow.tsx) so both pages share one row-action pattern.
function GearRowKebab({
  status,
  onEdit,
  onDelete,
  onSetStatus,
}: {
  status: GearStatus
  onEdit: () => void
  onDelete: () => void
  onSetStatus: (s: GearStatus) => void
}) {
  return (
    <KebabMenu ariaLabel="Item options" menuLabel="Item actions">
      {({ close }) => (
        <>
          <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
            Edit
          </RowMenuItem>
          <RowMenuSeparator />
          {/* Quick status — fast path that bypasses the full edit modal.
              Selecting the current status is a no-op inside the menu
              component; selecting a different status fires onSetStatus and
              we close the menu. */}
          <GearStatusMenuItems
            current={status}
            onSelect={(s) => { close(); onSetStatus(s) }}
          />
          <RowMenuSeparator />
          <RowMenuItem
            icon={<Trash2 size={13} />}
            onClick={() => { close(); onDelete() }}
            tone="danger"
          >
            Delete from inventory
          </RowMenuItem>
        </>
      )}
    </KebabMenu>
  )
}

// Sortable wrapper for the gear library page. Calls useSortable, wires the
// row's outer ref + transform style + a hover-revealed drag handle, then
// forwards everything to GearItemRow. Must be inside a SortableContext.
// Drag is disabled in select mode so the row's checkbox doesn't compete with
// the drag activator, and while a previous reorder mutation is in flight to
// prevent the rollback-clobber race when two reorders overlap.
//
// memo'd: this is the real per-row barrier. CategorySection forwards stable
// callback identities and a stable `item` reference, so when a parent re-render
// flips unrelated state (e.g. selecting another row changes selectedIds and
// re-renders the section), every row whose own props are unchanged skips. The
// inner GearItemRow is intentionally NOT memo'd - its outerStyle/dragHandle are
// recomputed from useSortable each render here, so a leaf memo would only ever
// miss. Drag still works: useSortable subscribes to DndContext, which re-renders
// this component on drag regardless of memo.
export const SortableGearItemRow = memo(function SortableGearItemRow(
  props: Omit<Props, 'dragHandle' | 'outerRef' | 'outerStyle'> & { reorderPending?: boolean },
) {
  const { outerRef, outerStyle, handleProps } = useSortableRow({
    kind: 'gear-item',
    id: props.item.id,
    disabled: props.selectMode || props.reorderPending,
  })

  // Use a dedicated grip at every viewport. Keep it inside the flat-table
  // surface: those surfaces use overflow-hidden for rounded corners, so an
  // outside-left gutter handle would be clipped. On mobile, the dedicated
  // touch target preserves normal row scrolling, while
  // the page-level TouchSensor keeps its delayed activation contract.
  const handle =
    props.selectMode ? undefined : (
      <RowIconButton
        {...handleProps}
        variant="dragHandle"
        touchSafe
        ariaLabel={`Reorder ${props.item.name}`}
        icon={<GripVertical size={14} />}
        className={props.isBelowLg ? '' : ROW_HOVER_REVEAL}
      />
    )

  return (
    <GearItemRow
      {...props}
      dragHandle={handle}
      outerRef={outerRef}
      outerStyle={outerStyle}
    />
  )
})
