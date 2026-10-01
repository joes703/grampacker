import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PrimaryButton from '../components/PrimaryButton'
import FoodDaySection from './FoodDaySection'
import AddFoodForm from './AddFoodForm'
import FoodCarryingList from './FoodCarryingList'
import FoodSlotPicker from './FoodSlotPicker'
import {
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import { queryKeys, mutationKeys } from '../lib/queries/keys'
import {
  createFoodItem,
  deleteFoodItem,
  fetchListFood,
  setFoodDays,
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
// for the weight breakdown and for the rows it renders in the Category and
// Pack arrangements (React Query dedupes the fetch). Moved verbatim from
// ListDetailPage when food got its own view.
export default function FoodView({ listId }: { listId: string }) {
  const qc = useQueryClient()
  const { weightUnit } = useWeightUnit()

  // The ONE query in the app that refetches on window focus, against the
  // global default in src/App.tsx. Every destructive food action lives on this
  // view - trimming the day count, rescheduling an item, removing one - and
  // each decides from this cache. staleTime only
  // MARKS data stale; without this, nothing refetches it, so a tab left open
  // overnight would still be acting on yesterday's plan and would delete meals
  // another client had added since.
  //
  // This narrows the window, it does not close it: you can still act in the
  // gap between the refetch and the write. The real fix is the food revision
  // guard in SECURITY.md. Deliberately NOT applied to the list detail page's
  // copy of this query (use-list-food.ts) - its food writes are per-row field
  // patches that cannot destroy another client's work.
  const listFoodQuery = useQuery({
    queryKey: queryKeys.listFood(listId),
    queryFn: () => fetchListFood(listId),
    refetchOnWindowFocus: true,
  })

  // Plain mutate-and-invalidate, deliberately not optimistic: a day-count
  // change rewrites the whole grid server-side, so there is no local transform
  // that predicts the result.
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
    // The PUT answers with the whole validated food document, so it goes
    // straight into the cache. The days box lets go of its typed draft when
    // this settles, and must land on the new length even if the follow-up
    // read fails or is paused offline - invalidation swallows both.
    // Cancel first: a read that started before the PUT answered carries the
    // old length, and once the view unmounts, invalidation no longer cancels
    // it, so it would land after this write and silently undo it.
    onSuccess: async (food) => {
      const key = queryKeys.listFood(listId)
      await qc.cancelQueries({ queryKey: key })
      qc.setQueryData(key, food)
      invalidateFood()
    },
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
  // Quantity is how many UNITS of this you carry. It was settable on the add
  // form and nowhere else, so every item sat at whatever it was created with -
  // usually 1 - and a plan of five lunches reported one packet in the pack
  // total. Same mutate-and-invalidate shape as the reschedule beside it.
  const foodItemQuantityMut = useMutation({
    mutationKey: mutationKeys.setFoodItemQuantity(listId),
    mutationFn: (vars: { itemId: string; quantity: number }) =>
      updateFoodItem(listId, vars.itemId, { quantity: vars.quantity }),
    meta: { errorToast: "Couldn't change that quantity. Please try again." },
    onSuccess: invalidateFood,
  })
  // Per-meal vs shared. Same shape as the quantity write beside it; a
  // separate mutation key so a mode flip and a count edit do not cancel each
  // other's invalidation.
  const foodItemModeMut = useMutation({
    mutationKey: mutationKeys.setFoodItemMode(listId),
    mutationFn: (vars: { itemId: string; isPerMeal: boolean }) =>
      updateFoodItem(listId, vars.itemId, { isPerMeal: vars.isPerMeal }),
    meta: { errorToast: "Couldn't change how that food is counted. Please try again." },
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
    foodItemCreateMut.isPending ||
    foodItemSlotsMut.isPending ||
    foodItemQuantityMut.isPending ||
    foodItemModeMut.isPending ||
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
      onSetDays={(days, onSettled) => foodDaysMut.mutate(days, { onSettled })}
      onAddItem={(input, onSuccess) =>
        foodItemCreateMut.mutate(input, { onSuccess: () => { invalidateFood(); onSuccess() } })
      }
      onDeleteItem={(itemId) => foodItemDeleteMut.mutate(itemId)}
      onSetItemSlots={(itemId, slotIds) => foodItemSlotsMut.mutate({ itemId, slotIds })}
      onSetItemQuantity={(itemId, quantity) =>
        foodItemQuantityMut.mutate({ itemId, quantity })
      }
      onSetItemPerMeal={(itemId, isPerMeal) =>
        foodItemModeMut.mutate({ itemId, isPerMeal })
      }
    />
  )
}

// True when shrinking to `days` would drop a slot that is holding food. Empty
// days are not work, so shortening a trip you have not planned yet asks
// nothing.
function losesWorkBelow(food: ListFoodResponse, days: number): boolean {
  const doomedIds = new Set(
    food.slots.filter((slot) => slot.dayNumber > days).map((slot) => slot.id),
  )
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
   *  trip. `onSettled` runs once the write has succeeded or failed. */
  onSetDays: (days: number, onSettled: () => void) => void
  onAddItem: (
    input: { name: string; weightGrams: number; quantity: number; slotIds: string[] },
    onSuccess: () => void,
  ) => void
  onDeleteItem: (itemId: string) => void
  /** Reschedule an existing item. Passing [] unschedules it without deleting
   *  it - the food is still carried, it just has no meal in mind. */
  onSetItemSlots: (itemId: string, slotIds: string[]) => void
  onSetItemQuantity: (itemId: string, quantity: number) => void
  onSetItemPerMeal: (itemId: string, isPerMeal: boolean) => void
}

// The resolved food document: a rail of cards (header with title and days
// input; the add-food card; the carrying list with its inline reschedule)
// beside the day grid. Everything here only ever runs
// once FoodView's query gate above has confirmed real data - see the
// comment on that gate.
function FoodDocument({
  food,
  weightUnit,
  busy,
  onSetDays,
  onAddItem,
  onDeleteItem,
  onSetItemSlots,
  onSetItemQuantity,
  onSetItemPerMeal,
}: FoodDocumentProps) {
  // What the user has typed into the days box, or null to show the server's
  // length. The day write is not optimistic, so a typed number is only a
  // request: it is dropped once the write settles, and on every revert, so
  // the box never keeps showing a length the list does not have.
  const [daysDraft, setDaysDraft] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const editingItem = food.items.find((item) => item.id === editingItemId) ?? null

  const [adding, setAdding] = useState(false)
  // Owned HERE, not in AddFoodForm: a per-slot "+ Add" must be able to union
  // a slot into an ALREADY-OPEN form without remounting it (a remount would
  // eat the typed name and weight). GATE 1 caught the captured-once version.
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([])
  const addFormRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  // Focus is not a courtesy here: the form sits BEFORE the day sections in
  // DOM order, so after clicking "+ Add" (or the button the form replaces)
  // Tab walks AWAY from the form and a keyboard user can never reach it
  // forward (GATE 2 finding). preventScroll keeps the focus jump from
  // fighting the smooth scroll below.
  function focusNameSoon() {
    requestAnimationFrame(() => nameInputRef.current?.focus({ preventScroll: true }))
  }

  function openAddForSlot(slotId: string) {
    setSelectedSlotIds((prev) => (prev.includes(slotId) ? prev : [...prev, slotId]))
    setAdding(true)
    focusNameSoon()
    // Scroll after the form mounts; rAF beats the render race without a
    // layout effect. rAF itself is available everywhere we run (including
    // jsdom); jsdom just doesn't implement Element.scrollIntoView, so that
    // call is optional-chained - a no-op under test, real behavior in a
    // browser. block 'start', not 'center': the card can be taller than the
    // rail's scrollport (30-day picker), and centering an oversized element
    // lands the user mid-picker with the Name field scrolled out of view.
    requestAnimationFrame(() =>
      addFormRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }),
    )
  }

  const itemsBySlot = new Map<string, ListFoodResponse['items']>()
  for (const item of food.items) {
    for (const slotId of item.slotIds) {
      const existing = itemsBySlot.get(slotId)
      if (existing) existing.push(item)
      else itemsBySlot.set(slotId, [item])
    }
  }

  const days = Array.from({ length: food.dayCount }, (_, i) => i + 1)
  const slotIds = new Set(food.slots.map((slot) => slot.id))
  // Selection can hold ids for slots trimmed after being picked (the picker no
  // longer shows them, so the user could neither see nor clear them). Filter at
  // the boundary: state may go stale harmlessly, but a stale id can never
  // render or submit.
  const activeSelectedSlotIds = selectedSlotIds.filter((id) => slotIds.has(id))

  return (
    // Desktop (lg+) is a two-column grid: the header card ("Food for N
    // days"), add-food card, and Carrying card stack in a sticky left rail
    // (tools left of the document, matching the edit-mode aside) so the
    // trip-length control and the per-slot "+ Add" form are always in view,
    // and the day sections take the full flexible width from the top. Below
    // lg the grid collapses to a stack with that panel ABOVE the day
    // sections - the add action stays reachable without scrolling a long
    // trip (D4 as revised 2026-08-07, docs/food-view-design.md). max-w-6xl
    // keeps ultra-wide monitors from stretching the day rows into a
    // corridor.
    <div className="mt-3 max-w-6xl">
      {/* gap (not space-y) so spacing holds in both the stacked flex layout
          and the lg grid, where child margins would land inside the cells.
          DOM order = mobile visual order (panel first, days second); the lg
          grid reads the same order into rail-left, days-right. */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:items-start">
        {/* top-4 matches the edit-mode aside's 1rem offset. The max-h +
            overflow pair is load-bearing, not polish: a top-only sticky
            element taller than the viewport stays pinned with its overflow
            unreachable until the end of the scroll container, and a 30-day
            trip's slot picker alone exceeds any viewport - without an
            internal scroll the form's Submit/Cancel could not be reached
            (GATE 2 finding). */}
        <div className="space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
          <section aria-labelledby="food-heading" className={FLAT_TABLE_SURFACE}>
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
                  value={daysDraft ?? String(food.dayCount)}
                  disabled={busy}
                  onChange={(e) => setDaysDraft(e.target.value)}
                  onBlur={() => {
                    if (daysDraft === null) return
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
                      setDaysDraft(null)
                      return
                    }
                    if (next === food.dayCount) {
                      setDaysDraft(null)
                      return
                    }
                    // Shrinking throws away the slots beyond the new count, and
                    // with them their placements. Ask, but only when there is
                    // actually something to lose.
                    //
                    // KNOWN GAP, stated rather than papered over: this decides from
                    // the client's cached food. It refetches on focus, but a tab that
                    // stays focused can be up to 30 seconds stale, and the write's
                    // preflight refetch does not re-ask. Another tab or device that
                    // schedules food onto a later day inside that window would be
                    // silently trimmed. Closing it properly needs a revision check on
                    // the write, which is more machinery than a single-user app has
                    // earned yet (SECURITY.md).
                    if (next < food.dayCount && losesWorkBelow(food, next)) {
                      const ok = window.confirm(
                        `Shortening the trip to ${next} ${next === 1 ? 'day' : 'days'} removes ` +
                          'the later meals, including what you had planned for them. ' +
                          'Your food items stay on the list. Continue?',
                      )
                      if (!ok) {
                        setDaysDraft(null)
                        return
                      }
                    }
                    onSetDays(next, () => setDaysDraft(null))
                  }}
                  className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-right tabular-nums"
                  aria-label="Trip length in days"
                />
                <span>days</span>
              </label>
            </div>
          </section>
          <section ref={addFormRef} className={`${FLAT_TABLE_SURFACE} px-3 py-2.5`}>
            {adding ? (
              <AddFoodForm
                slots={food.slots}
                busy={busy}
                weightUnit={weightUnit}
                nameInputRef={nameInputRef}
                selectedSlotIds={activeSelectedSlotIds}
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
              <PrimaryButton
                size="sm"
                disabled={busy}
                // The form mounts in this button's place, so the button's
                // focus dies with it - hand it to the Name field.
                onClick={() => {
                  setAdding(true)
                  focusNameSoon()
                }}
              >
                Add food
              </PrimaryButton>
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
                onSetQuantity={onSetItemQuantity}
                onTogglePerMeal={onSetItemPerMeal}
                onDelete={onDeleteItem}
              />
              {editingItem && (
                <div className="border-t border-gray-100 bg-blue-50/40 px-3 py-2">
                  <p className="mb-1.5 text-xs font-medium text-gray-700">
                    When are you eating {editingItem.name}?
                  </p>
                  <RescheduleForm
                    key={editingItem.id}
                    slots={food.slots}
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

        <div className="min-w-0">
          {food.dayCount === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-500">
              Set a trip length and every meal appears. Add what you are eating
              and when; that is what you need to pack.
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
                  onAddToSlot={openAddForSlot}
                />
              ))}
            </section>
          )}
        </div>
      </div>
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
        <PrimaryButton size="sm" disabled={busy} onClick={() => onSave(selected)}>
          Save
        </PrimaryButton>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
