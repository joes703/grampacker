import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import RowIconButton from '../components/RowIconButton'
import { FOOD_DAY_CAP, MEALS, type ListFoodResponse, type Meal } from '../../shared/food'
import type { WeightUnit } from '../lib/weight'

// The food estimate, walked day by day.
//
// The point of the day grid is NOT to plan meals - it is to stop you counting.
// You give the trip length, every eating period appears, you strike the ones
// you will not eat (breakfast on day 1, eaten in the car), and what remains is
// the meal count without anyone doing arithmetic. An expected-but-empty slot
// stays visible precisely because that is the omission this exists to catch.
//
// Three states, and they must stay distinguishable:
//   not needed  - you deliberately skipped it
//   empty       - you expected it and have not filled it (you forgot)
//   filled      - it has food
// A blank that could mean either of the first two would defeat the whole thing.
//
// There is deliberately no "complete" tick on a filled slot. A breakfast
// holding only coffee is non-empty and not necessarily enough; judging that is
// the user's job, not the app's.

// True when shrinking to `days` would drop a slot that is either holding food
// or has been explicitly marked not-needed. Untouched, empty days are not work,
// so shortening a trip you have not planned yet asks nothing.
function losesWorkBelow(food: ListFoodResponse, days: number): boolean {
  const doomed = food.slots.filter((slot) => slot.dayNumber > days)
  if (doomed.some((slot) => !slot.needed)) return true
  const doomedIds = new Set(doomed.map((slot) => slot.id))
  return food.items.some((item) => item.slotIds.some((id) => doomedIds.has(id)))
}

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: 'Breakfast',
  // Joe's definition: everything between breakfast and dinner. Not a sit-down.
  lunch: 'Lunch',
  dinner: 'Dinner',
}

type Props = {
  food: ListFoodResponse
  weightUnit: WeightUnit
  busy: boolean
  /** Called with the new length. The caller refetches before applying, so a
   *  shortening decided against a stale snapshot is narrowed to one round
   *  trip. */
  onSetDays: (days: number) => void
  onSetSlotNeeded: (slotId: string, needed: boolean) => void
  onAddItem: (
    input: { name: string; weightGrams: number; quantity: number; slotIds: string[] },
    onSuccess: () => void,
  ) => void
  onDeleteItem: (itemId: string) => void
  /** Reschedule an existing item. Passing [] unschedules it without deleting
   *  it - the food is still carried, it just has no meal in mind. */
  onSetItemSlots: (itemId: string, slotIds: string[]) => void
}

export default function FoodSection({
  food,
  weightUnit,
  busy,
  onSetDays,
  onSetSlotNeeded,
  onAddItem,
  onDeleteItem,
  onSetItemSlots,
}: Props) {
  const [daysDraft, setDaysDraft] = useState(String(food.dayCount))
  // Follow the server. Without this a rejected day change leaves the input
  // showing a length the list does not have.
  const [lastSeenDayCount, setLastSeenDayCount] = useState(food.dayCount)
  if (food.dayCount !== lastSeenDayCount) {
    setLastSeenDayCount(food.dayCount)
    setDaysDraft(String(food.dayCount))
  }
  const [adding, setAdding] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const editingItem = food.items.find((item) => item.id === editingItemId) ?? null

  const itemsBySlot = new Map<string, ListFoodResponse['items']>()
  for (const item of food.items) {
    for (const slotId of item.slotIds) {
      const existing = itemsBySlot.get(slotId)
      if (existing) existing.push(item)
      else itemsBySlot.set(slotId, [item])
    }
  }
  const unscheduled = food.items.filter((item) => item.slotIds.length === 0)

  // Derived, never editable. The user gives days and strikes slots; these
  // numbers are the consequence, and typing one directly is exactly the
  // arithmetic the grid exists to remove.
  const counts = MEALS.map((meal) => ({
    meal,
    count: food.slots.filter((slot) => slot.meal === meal && slot.needed).length,
  })).filter((entry) => entry.count > 0)

  const days = Array.from({ length: food.dayCount }, (_, i) => i + 1)

  return (
    <section aria-labelledby="food-heading" className={`mt-3 ${FLAT_TABLE_SURFACE}`}>
      <div className={`${FLAT_TABLE_HEADER} ${FLAT_TABLE_HEADER_PADDING} flex-wrap gap-2`}>
        <h3 id="food-heading" className={FLAT_TABLE_HEADER_TITLE}>
          Food
        </h3>
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <span>for</span>
          <input
            type="number"
            min={0}
            max={FOOD_DAY_CAP}
            value={daysDraft}
            disabled={busy}
            onChange={(e) => setDaysDraft(e.target.value)}
            onBlur={() => {
              // An EMPTY field is not zero. Number('') is 0, and 0 days deletes
              // every slot and every placement on the list - so clearing the
              // box to retype it would silently destroy the trip.
              const trimmed = daysDraft.trim()
              const next = Number(trimmed)
              if (
                trimmed === '' ||
                !Number.isInteger(next) ||
                next < 0 ||
                next > FOOD_DAY_CAP
              ) {
                setDaysDraft(String(food.dayCount))
                return
              }
              if (next === food.dayCount) return
              // Shrinking throws away the slots beyond the new count, and with
              // them their placements and any "not needed" decisions. Ask, but
              // only when there is actually something to lose.
              //
              // KNOWN GAP, stated rather than papered over: this decides from
              // the client's cached food, which is up to 30 seconds stale and
              // does not refetch on focus. Another tab that schedules food onto
              // a later day inside that window would be silently trimmed. The
              // refetch below shrinks the window to the round trip; closing it
              // properly needs a revision check on the write, which is more
              // machinery than a single-user app has earned yet.
              if (next < food.dayCount && losesWorkBelow(food, next)) {
                const ok = window.confirm(
                  `Shortening the trip to ${next} ${next === 1 ? 'day' : 'days'} removes ` +
                    'the later meals, including what you had planned for them. ' +
                    'Your food items stay on the list. Continue?',
                )
                if (!ok) {
                  setDaysDraft(String(food.dayCount))
                  return
                }
              }
              onSetDays(next)
            }}
            className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
            aria-label="Trip length in days"
          />
          <span>days</span>
        </label>
        {counts.length > 0 && (
          <span className={`shrink-0 ${FLAT_TABLE_EYEBROW}`}>
            {counts.map((entry) => `${entry.count} ${MEAL_LABELS[entry.meal].toLowerCase()}`).join(' · ')}
          </span>
        )}
      </div>

      {food.dayCount === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">
          Set a trip length and every meal appears. Strike the ones you will not
          eat; what is left is what you need to pack.
        </p>
      ) : (
        <div>
          {days.map((day) => (
            <div key={day} className="border-t border-gray-100 first:border-t-0">
              <div className={`px-3 pt-2 ${FLAT_TABLE_EYEBROW}`}>Day {day}</div>
              {MEALS.map((meal) => {
                const slot = food.slots.find(
                  (s) => s.dayNumber === day && s.meal === meal,
                )
                if (!slot) return null
                const slotItems = itemsBySlot.get(slot.id) ?? []
                return (
                  <div
                    key={slot.id}
                    className={`${FLAT_TABLE_ROW} flex items-center gap-2 ${
                      slot.needed ? '' : 'bg-gray-50'
                    }`}
                  >
                    <span
                      className={`w-20 shrink-0 ${FLAT_TABLE_META_TEXT} ${
                        slot.needed ? '' : 'line-through'
                      }`}
                    >
                      {MEAL_LABELS[meal]}
                    </span>
                    <span className="min-w-0 flex-1">
                      {!slot.needed ? (
                        <span className={FLAT_TABLE_META_TEXT}>Not needed</span>
                      ) : slotItems.length === 0 ? (
                        // The omission check. Reads as unfinished on purpose.
                        <span className="text-sm font-medium text-amber-700">
                          Nothing yet
                        </span>
                      ) : (
                        <span className={`block truncate ${FLAT_TABLE_BODY_TEXT}`}>
                          {slotItems.map((item) => item.name).join(', ')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        // Pruning a FILLED slot unschedules its food. The items
                        // survive and so does their weight - say so, because
                        // "not needed" sounds like it should be reversible.
                        if (slot.needed && slotItems.length > 0) {
                          const ok = window.confirm(
                            `${MEAL_LABELS[meal]} on day ${day} has food planned for it. ` +
                              'Marking it not needed unschedules that food - it stays ' +
                              'on the list and still counts toward your pack weight. ' +
                              'Continue?',
                          )
                          if (!ok) return
                        }
                        onSetSlotNeeded(slot.id, !slot.needed)
                      }}
                      className="shrink-0 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
                    >
                      {slot.needed ? 'Not needed' : 'Need it'}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {unscheduled.length > 0 && (
        <div className="border-t border-gray-100">
          <div className={`px-3 pt-2 ${FLAT_TABLE_EYEBROW}`}>Unscheduled</div>
          {unscheduled.map((item) => (
            <FoodItemRow
              key={item.id}
              item={item}
              weightUnit={weightUnit}
              busy={busy}
              onDelete={() => onDeleteItem(item.id)}
              onEditSlots={() => setEditingItemId(item.id)}
            />
          ))}
        </div>
      )}

      {food.items.length > 0 && (
        <div className="border-t border-gray-100">
          <div className={`px-3 pt-2 ${FLAT_TABLE_EYEBROW}`}>Carrying</div>
          {food.items.map((item) => (
            <FoodItemRow
              key={item.id}
              item={item}
              weightUnit={weightUnit}
              busy={busy}
              onDelete={() => onDeleteItem(item.id)}
              onEditSlots={() => setEditingItemId(item.id)}
            />
          ))}
        </div>
      )}

      {editingItem && (
        <div className="border-t border-gray-100 bg-blue-50/40 px-3 py-2">
          <p className="mb-1.5 text-xs font-medium text-gray-700">
            When are you eating {editingItem.name}?
          </p>
          <SlotPicker
            slots={food.slots.filter((slot) => slot.needed)}
            selected={editingItem.slotIds}
            busy={busy}
            onCancel={() => setEditingItemId(null)}
            onSave={(slotIds) => {
              onSetItemSlots(editingItem.id, slotIds)
              setEditingItemId(null)
            }}
          />
        </div>
      )}

      <div className="border-t border-gray-100 px-3 py-2">
        {adding ? (
          <AddFoodForm
            slots={food.slots.filter((slot) => slot.needed)}
            busy={busy}
            onCancel={() => setAdding(false)}
            // The form closes only once the add SUCCEEDS. Closing on submit
            // threw the typed name, weight and slot selection away whenever the
            // write failed - including at the item cap, where the user is most
            // likely to be told no.
            onSubmit={(input) => onAddItem(input, () => setAdding(false))}
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(true)}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
          >
            + Add food
          </button>
        )}
        {/* The app already labels gear consumables "food, fuel, water". Anyone
            keeping a "Food bag" gear row AND listing its contents here would
            count the same grams twice. */}
        <p className="mt-1.5 text-xs text-gray-500">
          Adds to your consumable weight. If you also have a food item in your
          gear list, remove it so it is not counted twice.
        </p>
      </div>
    </section>
  )
}

function FoodItemRow({
  item,
  weightUnit,
  busy,
  onDelete,
  onEditSlots,
}: {
  item: ListFoodResponse['items'][number]
  weightUnit: WeightUnit
  busy: boolean
  onDelete: () => void
  /** Opens the slot picker for this item. Present on BOTH scheduled and
   *  unscheduled rows: an item that lost its meals - because the slot was
   *  pruned or the trip was shortened - has to be repairable without deleting
   *  and retyping it. */
  onEditSlots?: () => void
}) {
  return (
    <div className={`${FLAT_TABLE_ROW} flex items-center gap-2`}>
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${FLAT_TABLE_BODY_TEXT}`}>{item.name}</span>
        <span className={`block ${FLAT_TABLE_META_TEXT}`}>
          {item.quantity > 1 ? `${item.quantity} × ` : ''}
          {item.slotIds.length > 0
            ? `${item.slotIds.length} ${item.slotIds.length === 1 ? 'meal' : 'meals'}`
            : 'Any time'}
        </span>
      </span>
      <ItemWeightValue grams={item.weightGrams * item.quantity} unit={weightUnit} />
      {onEditSlots && (
        <button
          type="button"
          disabled={busy}
          onClick={onEditSlots}
          className="shrink-0 rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
        >
          {item.slotIds.length > 0 ? 'Reschedule' : 'Schedule'}
        </button>
      )}
      <RowIconButton
        touchSafe
        onClick={onDelete}
        disabled={busy}
        ariaLabel={`Remove ${item.name}`}
        title="Remove"
        icon={<Trash2 size={14} />}
      />
    </div>
  )
}

function AddFoodForm({
  slots,
  busy,
  onCancel,
  onSubmit,
}: {
  slots: ListFoodResponse['slots']
  busy: boolean
  onCancel: () => void
  onSubmit: (input: {
    name: string
    weightGrams: number
    quantity: number
    slotIds: string[]
  }) => void
}) {
  const [name, setName] = useState('')
  const [weight, setWeight] = useState('')
  // ONE. Not the number of slots selected. The app cannot tell five packets
  // from one shared bag, and guessing high silently inflates the pack weight.
  const [quantity, setQuantity] = useState('1')
  const [selected, setSelected] = useState<string[]>([])

  const weightGrams = Number(weight)
  const quantityValue = Number(quantity)
  // Mirrors the server's bounds (shared/food.ts) so a rejection is not the
  // first the user hears that a name is too long or a weight out of range.
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 128 &&
    Number.isFinite(weightGrams) &&
    weightGrams >= 0 &&
    weightGrams <= 100000 &&
    Number.isInteger(quantityValue) &&
    quantityValue >= 1 &&
    quantityValue <= 9999

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (!valid) return
        onSubmit({
          name: name.trim(),
          weightGrams,
          quantity: quantityValue,
          slotIds: selected,
        })
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          aria-label="Food name"
          maxLength={128}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <input
          type="number"
          min={0}
          max={100000}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder="0"
          aria-label="Weight in grams"
          className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
        />
        <input
          type="number"
          min={1}
          max={9999}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-label="Units carried"
          className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-sm tabular-nums"
        />
      </div>
      {/* Direct multi-select. Whole-meal buttons for the common case, per-day
          checkboxes for the days that differ. No templates, no inheritance. */}
      <SlotChoices slots={slots} selected={selected} onChange={setSelected} />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !valid}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// The day x meal chooser, shared by the add form and by rescheduling an
// existing item. Whole-meal buttons for the common case, per-day checkboxes for
// the days that differ.
function SlotPicker({
  slots,
  selected: initial,
  busy,
  onCancel,
  onSave,
}: {
  slots: ListFoodResponse['slots']
  selected: string[]
  busy: boolean
  onCancel: () => void
  onSave: (slotIds: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  return (
    <div className="space-y-2">
      <SlotChoices slots={slots} selected={selected} onChange={setSelected} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(selected)}
          className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function SlotChoices({
  slots,
  selected,
  onChange,
}: {
  slots: ListFoodResponse['slots']
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggleMeal = (meal: Meal) => {
    const ids = slots.filter((slot) => slot.meal === meal).map((slot) => slot.id)
    const allOn = ids.every((id) => selected.includes(id))
    onChange(
      allOn
        ? selected.filter((id) => !ids.includes(id))
        : [...new Set([...selected, ...ids])],
    )
  }
  const days = [...new Set(slots.map((slot) => slot.dayNumber))].sort((a, b) => a - b)

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {MEALS.map((meal) => {
          const ids = slots.filter((slot) => slot.meal === meal).map((slot) => slot.id)
          if (ids.length === 0) return null
          const allOn = ids.every((id) => selected.includes(id))
          return (
            <button
              key={meal}
              type="button"
              aria-pressed={allOn}
              onClick={() => toggleMeal(meal)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                allOn
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Every {MEAL_LABELS[meal].toLowerCase()}
            </button>
          )
        })}
      </div>
      {days.length > 0 && (
        <div className="max-h-40 overflow-y-auto rounded border border-gray-200">
          {days.map((day) => (
            <div key={day} className="flex items-center gap-2 px-2 py-1">
              <span className={`w-12 shrink-0 ${FLAT_TABLE_META_TEXT}`}>Day {day}</span>
              {MEALS.map((meal) => {
                const slot = slots.find((s) => s.dayNumber === day && s.meal === meal)
                if (!slot) return null
                return (
                  <label
                    key={slot.id}
                    className="flex items-center gap-1 text-xs text-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(slot.id)}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...selected, slot.id]
                            : selected.filter((id) => id !== slot.id),
                        )
                      }
                      aria-label={`${MEAL_LABELS[meal]} day ${day}`}
                    />
                    {MEAL_LABELS[meal].slice(0, 1)}
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
