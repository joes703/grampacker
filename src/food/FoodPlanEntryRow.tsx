import { createPortal } from 'react-dom'
import { Apple, CircleMinus, Copy, FolderInput, MoreVertical, Pencil } from 'lucide-react'
import type { FoodItem, FoodPlanEntry } from '../lib/types'
import {
  FLAT_TABLE_BODY_TEXT, FLAT_TABLE_QUANTITY_TEXT, FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING, POPOVER_SURFACE,
} from '../components/flat-table-styles'
import { RowMenuItem } from '../components/RowMenuItem'
import RowIconButton from '../components/RowIconButton'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import { useWeightUnit } from '../lib/use-weight-unit'
import { MISSING_FOOD_LABEL, nutrientTotal, totalWeight } from '../lib/food/nutrition'
import NutrientTotalCell, { WeightCell } from './NutrientTotalCell'

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

// Basis-aware quantity text (design 3.1 grammar): plain servings, a package
// count resolved to its servings, or a gram weight. "package -> servings" keeps
// the entered package count visible AND the resolved servings, so the row never
// hides which basis the owner picked.
function quantityText(entry: FoodPlanEntry, food: FoodItem | undefined): string {
  const amt = formatAmount(entry.amount)
  switch (entry.basis) {
    case 'servings':
      return `${amt} ${entry.amount === 1 ? 'serving' : 'servings'}`
    case 'weight':
      return `${amt} g`
    case 'packages': {
      const pkg = `${amt} ${entry.amount === 1 ? 'package' : 'packages'}`
      const spp = food?.servings_per_package
      if (spp && spp > 0) return `${pkg} (${formatAmount(entry.amount * spp)} serv)`
      return pkg
    }
  }
}

// One presentational entry row in the Food Plan document. Table-like grammar
// (design Approach D): Food | Quantity | Calories | Weight | Actions, with
// Weight anchored at the far right before the kebab per the Chunk 1 column rule.
// Per-entry calories/weight reuse the same nutrient helpers as the aggregates,
// so unknown nutrition surfaces an IncompleteMarker (never a fake zero) and a
// genuinely-known weight stays known. On mobile the quantity + calories collapse
// into a subtitle under the name; the weight column stays visible.
export default function FoodPlanEntryRow({
  entry, food, onEdit, onEditFood, onMove, onCopy, onRemove, dragHandle, outerRef, outerStyle,
}: {
  entry: FoodPlanEntry
  food: FoodItem | undefined
  onEdit?: () => void
  onEditFood?: () => void
  onMove?: () => void
  onCopy?: () => void
  onRemove?: () => void
  dragHandle?: React.ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}) {
  const { weightUnit } = useWeightUnit()
  // "Edit food item" only makes sense when we actually resolved the library food
  // behind this entry, so gate it on `food`: a missing definition never opens an
  // empty edit dialog. The other entry actions stay available regardless.
  const editFood = food ? onEditFood : undefined
  const showKebab = Boolean(onEdit || editFood || onMove || onCopy || onRemove)
  const oneFood = new Map<string, FoodItem>(food ? [[food.id, food]] : [])
  const calories = nutrientTotal([entry], oneFood, 'calories')
  const weight = totalWeight([entry], oneFood)
  const nameForId = () => food?.name ?? MISSING_FOOD_LABEL
  const qty = quantityText(entry, food)

  return (
    <div
      ref={outerRef}
      style={outerStyle}
      className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_ROW_PADDING} gap-2 lg:gap-3 hover:bg-gray-50`}
    >
      {/* Drag-handle slot. Always reserved (even in Extras, which has no handle)
          so names line up across rows; the handle stays visible on touch since
          the TouchSensor activates on it. */}
      <span className="flex w-5 shrink-0 items-center justify-center">{dragHandle}</span>

      <span className="min-w-0 flex-1">
        <span className={`block truncate ${FLAT_TABLE_BODY_TEXT} text-gray-900`}>{food?.name ?? MISSING_FOOD_LABEL}</span>
        {/* Mobile subtitle: quantity + calories (the desktop columns are hidden
            below lg). Weight keeps its own column on every viewport. */}
        <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-400 lg:hidden">
          <span>{qty}</span>
          <span aria-hidden="true">-</span>
          <NutrientTotalCell total={calories} kind="calories" nameForId={nameForId} />
        </span>
      </span>

      <span data-testid="entry-quantity" className={`hidden w-36 shrink-0 text-right text-gray-500 lg:block ${FLAT_TABLE_QUANTITY_TEXT}`}>
        {qty}
      </span>
      <span data-testid="entry-calories" className="hidden w-20 shrink-0 text-right lg:block">
        <NutrientTotalCell total={calories} kind="calories" nameForId={nameForId} />
      </span>
      <span data-testid="entry-weight" className="w-20 shrink-0 text-right lg:w-24">
        <WeightCell weight={weight} weightUnit={weightUnit} nameForId={nameForId} />
      </span>

      <span className="flex w-7 shrink-0 items-center justify-center">
        {showKebab ? <EntryKebab onEdit={onEdit} onEditFood={editFood} onMove={onMove} onCopy={onCopy} onRemove={onRemove} /> : null}
      </span>
    </div>
  )
}

// Kebab popover for an entry row. Mirrors ItemRow's RowKebab: a three-dot
// trigger plus a portal-rendered menu, with dismissal handled by
// usePortalPopover (no hand-rolled listeners). Each row owns its own open
// state so only one menu can be open per row.
function EntryKebab({
  onEdit,
  onEditFood,
  onMove,
  onCopy,
  onRemove,
}: {
  onEdit?: () => void
  onEditFood?: () => void
  onMove?: () => void
  onCopy?: () => void
  onRemove?: () => void
}) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); if (menuOpen) close(); else openMenu() }}
        ariaLabel="Entry options"
        icon={<MoreVertical size={14} />}
      />

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {onEdit && (
            <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onEdit() }}>
              Edit quantity
            </RowMenuItem>
          )}
          {onEditFood && (
            <RowMenuItem icon={<Apple size={13} />} onClick={() => { close(); onEditFood() }}>
              Edit food item
            </RowMenuItem>
          )}
          {onMove && (
            <RowMenuItem icon={<FolderInput size={13} />} onClick={() => { close(); onMove() }}>
              Move to...
            </RowMenuItem>
          )}
          {onCopy && (
            <RowMenuItem icon={<Copy size={13} />} onClick={() => { close(); onCopy() }}>
              Copy to...
            </RowMenuItem>
          )}
          {onRemove && (
            <RowMenuItem icon={<CircleMinus size={13} />} onClick={() => { close(); onRemove() }} tone="removal">
              Remove
            </RowMenuItem>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
