import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import FoodDaySection from './FoodDaySection'
import AddFoodForm from './AddFoodForm'
import FoodCarryingList from './FoodCarryingList'
import FoodSlotPicker, { MEAL_LABELS } from './FoodSlotPicker'
import {
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import { queryKeys, mutationKeys } from '../lib/queries/keys'
import {
  createFoodItem,
  deleteFoodItem,
  fetchListFood,
  setFoodDays,
  setFoodSlotNeeded,
  updateFoodItem,
} from '../lib/queries/food'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import {
  FOOD_DAY_CAP,
  FOOD_ITEM_CAP,
  MEALS,
  type FoodSlotResponse,
  type ListFoodResponse,
} from '../../shared/food'
import { useWeightUnit } from '../lib/use-weight-unit'
import type { WeightUnit } from '../lib/weight'

// The Food view: /lists/:id/food. Owns the food document query and every food
// mutation; ListDetailPage keeps its OWN subscription to the same query key
// for the weight breakdown and the summary row (React Query dedupes the
// fetch). Moved verbatim from ListDetailPage when food got its own view.
export default function FoodView({ listId }: { listId: string }) {
  const qc = useQueryClient()
  const { weightUnit } = useWeightUnit()

  const listFoodQuery = useQuery({
    queryKey: queryKeys.listFood(listId),
    queryFn: () => fetchListFood(listId),
  })

  // Plain mutate-and-invalidate, deliberately not optimistic. A slot toggle
  // also clears that slot's associations server-side, and an optimistic
  // transform that flipped only `needed` would show a state the server is
  // never going to produce.
  const invalidateFood = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.listFood(listId) })
  }, [qc, listId])
  const foodDaysMut = useMutation({
    mutationKey: mutationKeys.setFoodDays(listId),
    // Refetch first: FoodDocument decides whether to warn about losing planned
    // meals from its cached snapshot, and that cache is up to 30s stale. This
    // narrows the window to a single round trip. It does not close it - that
    // needs a revision check on the write itself.
    mutationFn: async (days: number) => {
      await listFoodQuery.refetch()
      return setFoodDays(listId, days)
    },
    meta: { errorToast: "Couldn't change the trip length. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodSlotMut = useMutation({
    mutationKey: mutationKeys.setFoodSlot(listId),
    mutationFn: (vars: { slotId: string; needed: boolean }) =>
      setFoodSlotNeeded(listId, vars.slotId, vars.needed),
    meta: { errorToast: "Couldn't update that meal. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodItemCreateMut = useMutation({
    mutationKey: mutationKeys.createFoodItem(listId),
    mutationFn: (input: {
      name: string
      weightGrams: number
      quantity: number
      slotIds: string[]
    }) => createFoodItem(listId, input),
    // Deliberately no meta.errorToast: the server's 422 at the item cap and
    // its 400 for a stale slot each say something the generic message cannot,
    // and the cap is the one refusal a user can act on. onError surfaces the
    // real reason and consumes the rejection.
    onError: (err) => {
      const status = err instanceof ApiError ? err.status : 0
      showToast(
        status === 422
          ? `Food item limit reached (${FOOD_ITEM_CAP} per list).`
          : status === 400
            // 400 covers a pruned slot AND a value the server rejects, and the
            // client cannot tell which from the status alone - so the message
            // must not assert one of them.
            ? "Couldn't add that food - check the name, weight and meals and try again."
            : "Couldn't add that food. Please try again.",
        { type: 'error' },
      )
    },
    onSuccess: invalidateFood,
  })
  const foodItemSlotsMut = useMutation({
    mutationKey: mutationKeys.setFoodItemSlots(listId),
    mutationFn: (vars: { itemId: string; slotIds: string[] }) =>
      updateFoodItem(listId, vars.itemId, { slotIds: vars.slotIds }),
    meta: { errorToast: "Couldn't reschedule that food. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodItemDeleteMut = useMutation({
    mutationKey: mutationKeys.deleteFoodItem(listId),
    mutationFn: (itemId: string) => deleteFoodItem(listId, itemId),
    meta: { errorToast: "Couldn't remove that food. Please try again." },
    onSuccess: invalidateFood,
  })
  const foodBusy =
    foodDaysMut.isPending ||
    foodSlotMut.isPending ||
    foodItemCreateMut.isPending ||
    foodItemSlotsMut.isPending ||
    foodItemDeleteMut.isPending

  // Same three-state gate every reader uses (AGENTS.md): a fabricated empty
  // food object under live controls would let a day change write against
  // real rows. FoodDocument only renders on resolved data.
  if (listFoodQuery.isLoadingError) {
    return (
      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        Couldn't load the food plan.{' '}
        <button
          type="button"
          onClick={() => void listFoodQuery.refetch()}
          className="font-medium underline"
        >
          Retry
        </button>
      </div>
    )
  }
  if (listFoodQuery.isPending) {
    return <p className="mt-3 px-3 py-2 text-sm text-gray-500">Loading food…</p>
  }

  return (
    <FoodDocument
      food={listFoodQuery.data}
      weightUnit={weightUnit}
      busy={foodBusy}
      onSetDays={(days) => foodDaysMut.mutate(days)}
      onSetSlotNeeded={(slotId, needed) => foodSlotMut.mutate({ slotId, needed })}
      onAddItem={(input, onSuccess) =>
        foodItemCreateMut.mutate(input, { onSuccess: () => { invalidateFood(); onSuccess() } })
      }
      onDeleteItem={(itemId) => foodItemDeleteMut.mutate(itemId)}
      onSetItemSlots={(itemId, slotIds) => foodItemSlotsMut.mutate({ itemId, slotIds })}
    />
  )
}

// True when shrinking to `days` would drop a slot that is either holding food
// or has been explicitly marked not-needed. Untouched, empty days are not work,
// so shortening a trip you have not planned yet asks nothing.
function losesWorkBelow(food: ListFoodResponse, days: number): boolean {
  const doomed = food.slots.filter((slot) => slot.dayNumber > days)
  if (doomed.some((slot) => !slot.needed)) return true
  const doomedIds = new Set(doomed.map((slot) => slot.id))
  return food.items.some((item) => item.slotIds.some((id) => doomedIds.has(id)))
}

// All of a day's slots, in MEALS order, skipping any meal that has no slot
// yet (there always is one once dayCount covers that day, but this keeps the
// lookup total rather than assuming it).
function slotsForDay(food: ListFoodResponse, day: number): FoodSlotResponse[] {
  return MEALS.map((meal) => food.slots.find((s) => s.dayNumber === day && s.meal === meal)).filter(
    (slot): slot is FoodSlotResponse => slot !== undefined,
  )
}

type FoodDocumentProps = {
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

// The resolved food document: header (title, days input, meal counts,
// explainer), the day grid, the add-food card, and the carrying list with its
// inline reschedule. Everything here only ever runs once FoodView's query
// gate above has confirmed real data - see the comment on that gate.
function FoodDocument({
  food,
  weightUnit,
  busy,
  onSetDays,
  onSetSlotNeeded,
  onAddItem,
  onDeleteItem,
  onSetItemSlots,
}: FoodDocumentProps) {
  const [daysDraft, setDaysDraft] = useState(String(food.dayCount))
  // Follow the server. Without this a rejected day change leaves the input
  // showing a length the list does not have.
  const [lastSeenDayCount, setLastSeenDayCount] = useState(food.dayCount)
  if (food.dayCount !== lastSeenDayCount) {
    setLastSeenDayCount(food.dayCount)
    setDaysDraft(String(food.dayCount))
  }
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const editingItem = food.items.find((item) => item.id === editingItemId) ?? null

  const [adding, setAdding] = useState(false)
  // Owned HERE, not in AddFoodForm: a per-slot "+ Add" must be able to union
  // a slot into an ALREADY-OPEN form without remounting it (a remount would
  // eat the typed name and weight). GATE 1 caught the captured-once version.
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([])
  const addFormRef = useRef<HTMLDivElement | null>(null)

  function openAddForSlot(slotId: string) {
    setSelectedSlotIds((prev) => (prev.includes(slotId) ? prev : [...prev, slotId]))
    setAdding(true)
    // Scroll after the form mounts; rAF beats the render race without a
    // layout effect. jsdom (unit tests) implements neither rAF nor
    // scrollIntoView, so both calls are guarded - a no-op under test, the
    // real behavior in a browser.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() =>
        addFormRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }),
      )
    }
  }

  const itemsBySlot = new Map<string, ListFoodResponse['items']>()
  for (const item of food.items) {
    for (const slotId of item.slotIds) {
      const existing = itemsBySlot.get(slotId)
      if (existing) existing.push(item)
      else itemsBySlot.set(slotId, [item])
    }
  }

  // Derived, never editable. The user gives days and strikes slots; these
  // numbers are the consequence, and typing one directly is exactly the
  // arithmetic the grid exists to remove.
  const counts = MEALS.map((meal) => ({
    meal,
    count: food.slots.filter((slot) => slot.meal === meal && slot.needed).length,
  })).filter((entry) => entry.count > 0)

  const days = Array.from({ length: food.dayCount }, (_, i) => i + 1)
  const neededSlots = food.slots.filter((slot) => slot.needed)

  return (
    <div className="mt-3 space-y-3">
      <section className={FLAT_TABLE_SURFACE}>
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
        <p className={`px-3 pb-2 ${FLAT_TABLE_META_TEXT}`}>
          Skip meals you'll eat in town or on the road.
        </p>
      </section>

      {food.dayCount === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">
          Set a trip length and every meal appears. Strike the ones you will not
          eat; what is left is what you need to pack.
        </p>
      ) : (
        <section className={FLAT_TABLE_SURFACE}>
          {days.map((day) => (
            <FoodDaySection
              key={day}
              day={day}
              slots={slotsForDay(food, day)}
              itemsBySlot={itemsBySlot}
              weightUnit={weightUnit}
              busy={busy}
              onSetSlotNeeded={onSetSlotNeeded}
              onAddToSlot={openAddForSlot}
            />
          ))}
        </section>
      )}

      <section ref={addFormRef} className={`${FLAT_TABLE_SURFACE} px-3 py-2.5`}>
        {adding ? (
          <AddFoodForm
            slots={neededSlots}
            busy={busy}
            weightUnit={weightUnit}
            selectedSlotIds={selectedSlotIds}
            onSelectedSlotIdsChange={setSelectedSlotIds}
            onCancel={() => {
              setAdding(false)
              setSelectedSlotIds([])
            }}
            // The form closes only once the add SUCCEEDS. Closing on submit
            // threw the typed name, weight and slot selection away whenever
            // the write failed - including at the item cap, where the user
            // is most likely to be told no.
            onSubmit={(input, onSuccess) =>
              onAddItem(input, () => {
                onSuccess()
                setAdding(false)
                setSelectedSlotIds([])
              })
            }
          />
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setAdding(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add food
          </button>
        )}
      </section>

      {food.items.length > 0 && (
        <section className={FLAT_TABLE_SURFACE}>
          <div className={`px-3 pt-2 ${FLAT_TABLE_EYEBROW}`}>Carrying</div>
          <FoodCarryingList
            items={food.items}
            weightUnit={weightUnit}
            busy={busy}
            onReschedule={setEditingItemId}
            onDelete={onDeleteItem}
          />
          {editingItem && (
            <div className="border-t border-gray-100 bg-blue-50/40 px-3 py-2">
              <p className="mb-1.5 text-xs font-medium text-gray-700">
                When are you eating {editingItem.name}?
              </p>
              <RescheduleForm
                key={editingItem.id}
                slots={neededSlots}
                initialSlotIds={editingItem.slotIds}
                busy={busy}
                onCancel={() => setEditingItemId(null)}
                onSave={(slotIds) => {
                  onSetItemSlots(editingItem.id, slotIds)
                  setEditingItemId(null)
                }}
              />
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// Draft wrapper around the controlled FoodSlotPicker for rescheduling one
// item: Save commits, Cancel discards. Keyed by item id at the call site so
// switching which item you are rescheduling always starts the draft from
// that item's own current slots, rather than carrying over the previous
// item's in-progress selection.
function RescheduleForm({
  slots,
  initialSlotIds,
  busy,
  onCancel,
  onSave,
}: {
  slots: readonly FoodSlotResponse[]
  initialSlotIds: readonly string[]
  busy: boolean
  onCancel: () => void
  onSave: (slotIds: string[]) => void
}) {
  const [selected, setSelected] = useState<string[]>([...initialSlotIds])
  return (
    <div className="space-y-2">
      <FoodSlotPicker slots={slots} selected={selected} onChange={setSelected} />
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
