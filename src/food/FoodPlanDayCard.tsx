import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MoreVertical, Trash2 } from 'lucide-react'
import type { FoodItem, Meal } from '../lib/types'
import type { DayView } from './useFoodPlanDocument'
import { FLAT_TABLE_SURFACE, POPOVER_SURFACE } from '../components/flat-table-styles'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import { usePortalPopover } from '../lib/use-portal-popover'
import MealSection from './MealSection'

export default function FoodPlanDayCard({
  dayView, dayIndex, foodById, headerAction, renderCell, onAddFoodToCell, onEditEntry, onRemoveEntry,
  onSetDayType, onDeleteDay, allMeals, onOmitMeal, onDeleteMeal, onRestoreMeal,
}: {
  dayView: DayView
  dayIndex: number
  foodById: Map<string, FoodItem>
  headerAction?: React.ReactNode
  renderCell?: (dayMealId: string) => React.ReactNode
  onAddFoodToCell?: (dayMealId: string) => void
  onEditEntry?: (entryId: string) => void
  onRemoveEntry?: (entryId: string) => void
  onSetDayType?: (override: 'full' | 'partial' | null) => void
  onDeleteDay?: () => void
  allMeals?: Meal[]
  onOmitMeal?: (dayMealId: string) => void
  onDeleteMeal?: (mealId: string) => void
  onRestoreMeal?: (dayId: string, mealId: string) => void
}) {
  return (
    <div className={FLAT_TABLE_SURFACE}>
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-sm font-semibold text-gray-900">Day {dayIndex + 1}</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-400">{dayView.dayType}</span>
          {headerAction}
          {(onSetDayType || onDeleteDay) && (
            <DayKebab currentOverride={dayView.day.day_type_override} onSetDayType={onSetDayType} onDeleteDay={onDeleteDay} />
          )}
        </div>
      </div>
      {dayView.cells.map((cell) => (
        <MealSection
          key={cell.dayMealId}
          cell={cell}
          foodById={foodById}
          headerAction={renderCell?.(cell.dayMealId)}
          onAddFood={onAddFoodToCell ? () => onAddFoodToCell(cell.dayMealId) : undefined}
          onEditEntry={onEditEntry}
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
  )
}

// Kebab popover for a day card. Mirrors FoodPlanEntryRow's EntryKebab: a
// three-dot trigger plus a portal-rendered menu, with dismissal handled by
// usePortalPopover (no hand-rolled listeners). Lets the user override the
// day type (Auto/Full/Partial) or delete the day.
function DayKebab({ currentOverride, onSetDayType, onDeleteDay }: {
  currentOverride: 'full' | 'partial' | null
  onSetDayType?: (override: 'full' | 'partial' | null) => void
  onDeleteDay?: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = () => setOpen(false)

  usePortalPopover({ isOpen: open, onClose: close, triggerRef, contentRef: menuRef })

  function menuPos() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return { top: 0, left: 0 }
    return { top: rect.bottom + 4, left: rect.right - 192 }
  }
  const pos = open ? menuPos() : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-label="Day options"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreVertical size={14} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={`fixed z-50 w-48 py-1 ${POPOVER_SURFACE}`}
          style={{ top: pos.top, left: pos.left }}
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
          <RowMenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDeleteDay?.() }} tone="removal">
            Delete day
          </RowMenuItem>
        </div>,
        document.body,
      )}
    </>
  )
}
