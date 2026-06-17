import { createPortal } from 'react-dom'
import { useId, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, MoreVertical, Trash2 } from 'lucide-react'
import type { FoodItem, Meal, MealTarget } from '../lib/types'
import type { DayView } from './useFoodPlanDocument'
import { FLAT_TABLE_SURFACE, POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import { useAnchoredMenu } from '../lib/use-anchored-menu'
import MealSection from './MealSection'
import DayTotalsStrip from './DayTotalsStrip'

function dayTypeTitle(dayType: 'full' | 'partial', override: 'full' | 'partial' | null) {
  const base = dayType === 'partial'
    ? 'Partial day - excluded from the full-day average and target check.'
    : 'Full day - included in the full-day average and target check.'
  return override === null ? base : `${base} Set manually.`
}

export default function FoodPlanDayCard({
  dayView, dayIndex, listId, userId, foodById, mealTargets, onAddFoodToCell, onEditEntry, onMoveEntry, onCopyEntry, onRemoveEntry,
  onSetDayType, onDeleteDay, onDuplicate, allMeals, onOmitMeal, onDeleteMeal, onRestoreMeal,
  dragHandle, outerRef, outerStyle,
}: {
  dayView: DayView
  dayIndex: number
  listId: string
  userId: string
  foodById: Map<string, FoodItem>
  mealTargets?: MealTarget[]
  onAddFoodToCell?: (dayMealId: string) => void
  onEditEntry?: (entryId: string) => void
  onMoveEntry?: (entryId: string) => void
  onCopyEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
  onSetDayType?: (override: 'full' | 'partial' | null) => void
  onDeleteDay?: () => void
  onDuplicate?: () => void
  allMeals?: Meal[]
  onOmitMeal?: (dayMealId: string) => void
  onDeleteMeal?: (mealId: string) => void
  onRestoreMeal?: (dayId: string, mealId: string) => void
  dragHandle?: React.ReactNode
  outerRef?: (el: HTMLElement | null) => void
  outerStyle?: React.CSSProperties
}) {
  const [open, setOpen] = useState(true)
  const title = `Day ${dayIndex + 1}`
  const bodyId = useId()

  return (
    <div ref={outerRef} style={outerStyle} className={FLAT_TABLE_SURFACE}>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1">
          {dragHandle}
          <h2>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-controls={bodyId}
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
              className="inline-flex items-center gap-1 rounded text-left text-sm font-semibold text-gray-900 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {open ? (
                <ChevronDown size={15} className="text-gray-400" />
              ) : (
                <ChevronRight size={15} className="text-gray-400" />
              )}
              <span>{title}</span>
            </button>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <DayTotalsStrip dayView={dayView} foodById={foodById} />
          <span
            title={dayTypeTitle(dayView.dayType, dayView.day.day_type_override)}
            className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-gray-400"
          >
            <span>{dayView.dayType}</span>
            {dayView.day.day_type_override !== null ? (
              <span className="normal-case tracking-normal">(manual)</span>
            ) : null}
          </span>
          {(onSetDayType || onDeleteDay || onDuplicate) && (
            <DayKebab currentOverride={dayView.day.day_type_override} onSetDayType={onSetDayType} onDeleteDay={onDeleteDay} onDuplicate={onDuplicate} />
          )}
        </div>
      </div>
      {open ? (
        <div id={bodyId}>
          {dayView.cells.map((cell) => (
            <MealSection
              key={cell.dayMealId}
              cell={cell}
              listId={listId}
              userId={userId}
              foodById={foodById}
              mealTargets={(mealTargets ?? []).filter((t) => t.meal_id === cell.meal.id)}
              onAddFood={onAddFoodToCell ? () => onAddFoodToCell(cell.dayMealId) : undefined}
              onEditEntry={onEditEntry}
              onMoveEntry={onMoveEntry}
              onCopyEntry={onCopyEntry}
              onRemoveEntry={onRemoveEntry}
              onOmit={onOmitMeal ? () => onOmitMeal(cell.dayMealId) : undefined}
              onDeleteMeal={onDeleteMeal ? () => onDeleteMeal(cell.meal.id) : undefined}
            />
          ))}
          {allMeals && onRestoreMeal
            ? allMeals
                .filter((m) => !dayView.scheduledMealIds.has(m.id))
                .map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onRestoreMeal(dayView.day.id, m.id)}
                    className="px-3 py-2 text-sm font-medium text-emerald-700 hover:underline"
                  >
                    + Restore {m.name}
                  </button>
                ))
            : null}
        </div>
      ) : null}
    </div>
  )
}

// Kebab popover for a day card. Mirrors FoodPlanEntryRow's EntryKebab: a
// three-dot trigger plus a portal-rendered menu, with dismissal handled by
// usePortalPopover (no hand-rolled listeners). Lets the user override the
// day type (Auto/Full/Partial) or delete the day.
function DayKebab({ currentOverride, onSetDayType, onDeleteDay, onDuplicate }: {
  currentOverride: 'full' | 'partial' | null
  onSetDayType?: (override: 'full' | 'partial' | null) => void
  onDeleteDay?: () => void
  onDuplicate?: () => void
}) {
  const { open: menuOpen, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 192 })

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); if (menuOpen) close(); else openMenu() }}
        aria-label="Day options"
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
          <RowMenuItem
            icon={currentOverride === null ? <Check size={13} /> : undefined}
            onClick={() => { close(); onSetDayType?.(null) }}
          >
            Auto
          </RowMenuItem>
          <RowMenuItem
            icon={currentOverride === 'full' ? <Check size={13} /> : undefined}
            onClick={() => { close(); onSetDayType?.('full') }}
          >
            Full
          </RowMenuItem>
          <RowMenuItem
            icon={currentOverride === 'partial' ? <Check size={13} /> : undefined}
            onClick={() => { close(); onSetDayType?.('partial') }}
          >
            Partial
          </RowMenuItem>
          <RowMenuSeparator />
          <RowMenuItem icon={<Copy size={13} />} onClick={() => { close(); onDuplicate?.() }}>
            Duplicate day
          </RowMenuItem>
          <RowMenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDeleteDay?.() }} tone="removal">
            Delete day
          </RowMenuItem>
        </div>,
        document.body,
      )}
    </>
  )
}
