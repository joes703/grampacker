import { createPortal } from 'react-dom'
import { CircleMinus, MoreVertical, Trash2 } from 'lucide-react'
import type { FoodItem, MealTarget } from '../lib/types'
import type { CellView } from './useFoodPlanDocument'
import { FLAT_TABLE_HEADER, POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
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
    <section className="mt-2">
      <div className={`${FLAT_TABLE_HEADER} flex items-center justify-between`}>
        <span>{cell.meal.name}</span>
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
        <button type="button" onClick={onAddFood} className="px-3 py-2 text-sm font-medium text-emerald-700 hover:underline">
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
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (menuOpen) close(); else openMenu() }}
        aria-label="Meal options"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreVertical size={14} />
      </button>

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
