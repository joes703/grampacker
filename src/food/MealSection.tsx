import { createPortal } from 'react-dom'
import { CircleMinus, MoreVertical, Trash2 } from 'lucide-react'
import type { FoodItem, MealTarget } from '../lib/types'
import type { CellView } from './useFoodPlanDocument'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import RowIconButton from '../components/RowIconButton'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import CellEntryReorder from './CellEntryReorder'
import MealTargetsBar from './MealTargetsBar'

export default function MealSection({
  cell, listId, userId, foodById, mealTargets, onAddFood, onEditEntry, onMoveEntry, onCopyEntry, onRemoveEntry, onOmit, onDeleteMeal,
}: {
  cell: CellView
  listId: string
  userId: string
  foodById: Map<string, FoodItem>
  mealTargets: MealTarget[]
  onAddFood?: () => void
  onEditEntry?: (entryId: string) => void
  onMoveEntry?: (entryId: string) => void
  onCopyEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
  onOmit?: () => void
  onDeleteMeal?: () => void
}) {
  return (
    <section>
      <div
        data-testid="meal-section-header"
        className="flex items-center justify-between border-t border-gray-100 px-3 py-1 pl-6"
      >
        <span className="text-sm font-medium text-gray-500">{cell.meal.name}</span>
        <span className="flex items-center gap-2">
          {(onOmit || onDeleteMeal) && <MealKebab onOmit={onOmit} onDeleteMeal={onDeleteMeal} />}
        </span>
      </div>
      <MealTargetsBar entries={cell.entries} foodById={foodById} mealTargets={mealTargets} />
      <CellEntryReorder
        listId={listId}
        userId={userId}
        dayMealId={cell.dayMealId}
        foodById={foodById}
        onEditEntry={onEditEntry}
        onMoveEntry={onMoveEntry}
        onCopyEntry={onCopyEntry}
        onRemoveEntry={onRemoveEntry}
      />
      {onAddFood ? (
        <button type="button" onClick={onAddFood} className="px-3 py-2 text-sm font-medium text-blue-600 hover:underline">
          + Add food
        </button>
      ) : null}
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
