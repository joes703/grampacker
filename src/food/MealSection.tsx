import { createPortal } from 'react-dom'
import { CircleMinus, MoreVertical, Plus, Trash2 } from 'lucide-react'
import type { FoodItem } from '../lib/types'
import type { CellView } from './useFoodPlanDocument'
import { FLAT_TABLE_EYEBROW, POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import RowIconButton from '../components/RowIconButton'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import { nutrientTotal } from '../lib/food/nutrition'
import NutrientTotalCell from './NutrientTotalCell'
import CellEntryReorder from './CellEntryReorder'

// One meal divider + its entries in the Food Plan document (design Approach D).
// The divider is a gray-50 sub-strip: an indented uppercase eyebrow meal name,
// the entry count, the meal calorie total (desktop), then the add-food control
// and the kebab on the right. The per-meal nutrient strip (Cal / Protein /
// Fat% / Sugar% / Carb:Pro / Na density) deliberately does NOT live here any
// more - that detail moved to the Day nutrition review panel so the document
// reads as day totals -> meal totals -> entry quantity/calories/weight.
export default function MealSection({
  cell, listId, userId, foodById, onAddFood, onEditEntry, onEditFood, onMoveEntry, onCopyEntry, onRemoveEntry, onOmit, onDeleteMeal,
}: {
  cell: CellView
  listId: string
  userId: string
  foodById: Map<string, FoodItem>
  onAddFood?: () => void
  onEditEntry?: (entryId: string) => void
  onEditFood?: (foodItemId: string) => void
  onMoveEntry?: (entryId: string) => void
  onCopyEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
  onOmit?: () => void
  onDeleteMeal?: () => void
}) {
  const count = cell.entries.length
  const mealCalories = nutrientTotal(cell.entries, foodById, 'calories')
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'

  return (
    <section>
      <div
        data-testid="meal-section-header"
        className="flex items-center gap-2 border-y border-gray-100 bg-gray-50 px-3 py-1.5 pl-6"
      >
        <span className={FLAT_TABLE_EYEBROW}>{cell.meal.name}</span>
        <span className="text-xs tabular-nums text-gray-400">{count === 0 ? 'empty' : count}</span>
        <span className="ml-auto flex items-center gap-2">
          {count > 0 ? (
            <span className="hidden lg:inline">
              <NutrientTotalCell total={mealCalories} kind="calories" nameForId={nameForId} />
            </span>
          ) : null}
          {onAddFood ? (
            <button
              type="button"
              onClick={onAddFood}
              aria-label="Add food"
              className="inline-flex h-7 items-center gap-1 rounded border border-gray-300 bg-white px-2 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700"
            >
              <Plus size={13} aria-hidden="true" />
              <span className="hidden sm:inline">Add</span>
            </button>
          ) : null}
          {(onOmit || onDeleteMeal) && <MealKebab onOmit={onOmit} onDeleteMeal={onDeleteMeal} />}
        </span>
      </div>
      <CellEntryReorder
        listId={listId}
        userId={userId}
        dayMealId={cell.dayMealId}
        foodById={foodById}
        onEditEntry={onEditEntry}
        onEditFood={onEditFood}
        onMoveEntry={onMoveEntry}
        onCopyEntry={onCopyEntry}
        onRemoveEntry={onRemoveEntry}
      />
    </section>
  )
}

// Kebab popover for a meal section header. Mirrors DayKebab/EntryKebab: a
// three-dot trigger plus a portal-rendered menu, with dismissal handled by
// usePortalPopover (no hand-rolled listeners). Lets the user omit this meal on
// the current day or delete the meal from every day.
function MealKebab({ onOmit, onDeleteMeal }: {
  onOmit?: () => void
  onDeleteMeal?: () => void
}) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <RowIconButton
        ref={triggerRef}
        onClick={(e) => { e.stopPropagation(); if (menuOpen) close(); else openMenu() }}
        ariaLabel="Meal options"
        icon={<MoreVertical size={14} />}
      />

      {menuOpen && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {onOmit && (
            <RowMenuItem icon={<CircleMinus size={13} />} onClick={() => { close(); onOmit() }} tone="removal">
              Omit on this day
            </RowMenuItem>
          )}
          {onOmit && onDeleteMeal && <RowMenuSeparator />}
          {onDeleteMeal && (
            <RowMenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDeleteMeal() }} tone="removal">
              Delete meal everywhere
            </RowMenuItem>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
