import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import PrimaryButton from '../components/PrimaryButton'
import FoodDaySection, { FoodPlanColumnLabels, FoodPlanRow } from './FoodDaySection'
import FoodItemDialog, { type FoodItemDialogMode } from './FoodItemDialog'
import {
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_SURFACE,
  FORM_INPUT,
} from '../components/flat-table-styles'
import { queryKeys, mutationKeys } from '../lib/queries/keys'
import { queries } from '../lib/queries/options'
import {
  createFoodItem,
  deleteFoodItem,
  fetchListFood,
  setFoodDays,
  updateFoodItem,
} from '../lib/queries/food'
import { foodGramsFor } from '../lib/weight-breakdown'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import { reportFailure } from '../lib/report-failure'
import {
  FOOD_DAY_CAP,
  FOOD_ITEM_CAP,
  MEALS,
  type CreateFoodItemRequest,
  type FoodSlotResponse,
  type ListFoodResponse,
  type UpdateFoodItemRequest,
} from '../../shared/food'
import { useWeightUnit } from '../lib/use-weight-unit'
import { formatTotalWeight, type WeightUnit } from '../lib/weight'

// The Food view: /lists/:id/food. Owns the food document query and every food
// mutation; ListDetailPage keeps its OWN subscription to the same query key
// for the weight breakdown and for the rows it renders in the Category and
// Pack arrangements (React Query dedupes the fetch).
//
// The layout is the 2026-10 redesign: a planning header (trip length, food
// weight, add) over a single column of day tables, with the meal plan as the
// ONE editing surface (every "+ add" and every food line opens
// FoodItemDialog). The shopping tally that used to sit beside the plan was
// removed deliberately: it repeated the unitCount the Category and Pack food
// rows already show, and a buy-count is read at the store, where those views
// are the ones open.
export default function FoodView({ listId }: { listId: string }) {
  const qc = useQueryClient()
  const { weightUnit } = useWeightUnit()

  // The ONE query in the app that refetches on window focus, against the
  // global default in src/App.tsx. Every destructive food action lives on this
  // view. Rescheduling and removing an item decide from this cache; trimming
  // the day count reads fresh first (changeDays below). staleTime only
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
    ...queries.listFood(listId),
    refetchOnWindowFocus: true,
  })

  // The editor dialog. State lives HERE, not in FoodDocument, because the
  // mutations' onError handlers below write into it: the dialog shows its own
  // failure inline while it is on screen, and reportFailure falls back to a
  // toast when the failure lands after the dialog (or the view) is gone - a
  // per-call callback alone would be dropped on unmount and the failure would
  // vanish (src/lib/report-failure.ts).
  const [dialog, setDialog] = useState<
    { kind: 'add'; slotIds: string[] } | { kind: 'edit'; itemId: string } | null
  >(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const dialogAnchorRef = useRef<HTMLParagraphElement | null>(null)
  // Bumped on every open AND close. Dismissal stays live during a pending
  // write ("never gate the way out"), so a request can outlive the dialog
  // that issued it - its callbacks compare the sequence they captured against
  // this, and a stale success must not close a dialog opened since, nor a
  // stale failure write into one.
  const dialogSeq = useRef(0)

  const foodData = listFoodQuery.data
  const editingItem =
    dialog?.kind === 'edit'
      ? (foodData?.items.find((item) => item.id === dialog.itemId) ?? null)
      : null

  // Close the editor when its item disappears from a RESOLVED plan (deleted
  // elsewhere, then refetched). A failed refetch keeps the old data, so a
  // network blip alone never closes the dialog; an item merely unscheduled
  // still exists and stays editable. State is adjusted during render (the
  // guarded same-component setState React documents for derived resets), not
  // in an effect: clearing it, rather than only deriving a null dialogMode,
  // stops an OLDER read that still holds the item from reopening the dialog
  // after the user watched it close.
  // No seq bump here (a ref must not be written during render, and none is
  // needed: with no dialog open, a still-matching failure finds its anchor
  // disconnected and falls through to a toast anyway).
  if (dialog?.kind === 'edit' && foodData && !editingItem) {
    setDialog(null)
  }

  function openDialog(next: { kind: 'add'; slotIds: string[] } | { kind: 'edit'; itemId: string }) {
    dialogSeq.current += 1
    setDialogError(null)
    setDialog(next)
  }

  function closeDialog() {
    dialogSeq.current += 1
    setDialog(null)
  }

  // Routes a write failure to the dialog that issued it, or to a toast when
  // that dialog is gone - closed/replaced (stale seq) or unmounted with the
  // view (reportFailure's disconnected-anchor check).
  function reportDialogFailure(seq: number, message: string) {
    if (seq === dialogSeq.current) {
      reportFailure(dialogAnchorRef.current, message, setDialogError)
    } else {
      showToast(message, { type: 'error' })
    }
  }

  // Plain mutate-and-invalidate, deliberately not optimistic: a day-count
  // change rewrites the whole grid server-side, so there is no local transform
  // that predicts the result.
  const invalidateFood = useCallback(() => {
    void qc.invalidateQueries({ queryKey: queryKeys.listFood(listId) })
  }, [qc, listId])
  const foodDaysMut = useMutation({
    mutationKey: mutationKeys.setFoodDays(listId),
    mutationFn: (days: number) => setFoodDays(listId, days),
    // A lost response can follow a write that committed, so the copy does not
    // claim the length is unchanged. onError refreshes the box to what is saved.
    meta: { errorToast: "Couldn't confirm the trip length changed. Please check it and try again." },
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
    onError: invalidateFood,
  })
  // The three editor mutations report failures through the dialog (inline
  // while it is on screen, toast after it is gone). Error copy never claims
  // the write did not happen: a lost response can follow a commit, so it says
  // "couldn't confirm" and tells the user to check before retrying
  // (AGENTS.md's ambiguous-write rule) - except the two create rejections the
  // server actually decided (the cap 422 and the validation 400), which are
  // certain and keep their specific messages.
  const foodItemCreateMut = useMutation({
    mutationKey: mutationKeys.createFoodItem(listId),
    mutationFn: (vars: { input: CreateFoodItemRequest; seq: number }) =>
      createFoodItem(listId, vars.input),
    onError: (err, vars) => {
      const status = err instanceof ApiError ? err.status : 0
      reportDialogFailure(
        vars.seq,
        status === 422
          ? `Food item limit reached (${FOOD_ITEM_CAP} per list).`
          : status === 400
            // 400 covers a pruned slot AND a value the server rejects, and the
            // client cannot tell which from the status alone - so the message
            // must not assert one of them.
            ? "Couldn't add that food - check the name, weight and meals and try again."
            : "Couldn't confirm the food was added. Check the plan before trying again.",
      )
    },
    onSuccess: invalidateFood,
  })
  const foodItemUpdateMut = useMutation({
    mutationKey: mutationKeys.updateFoodItem(listId),
    mutationFn: (vars: { itemId: string; patch: UpdateFoodItemRequest; seq: number }) =>
      updateFoodItem(listId, vars.itemId, vars.patch),
    onError: (_err, vars) => {
      reportDialogFailure(
        vars.seq,
        "Couldn't confirm that change saved. Check the plan before trying again.",
      )
    },
    onSuccess: invalidateFood,
  })
  const foodItemDeleteMut = useMutation({
    mutationKey: mutationKeys.deleteFoodItem(listId),
    mutationFn: (vars: { itemId: string; seq: number }) =>
      deleteFoodItem(listId, vars.itemId),
    onError: (_err, vars) => {
      reportDialogFailure(
        vars.seq,
        "Couldn't confirm that food was removed. Check the plan before trying again.",
      )
    },
    onSuccess: invalidateFood,
  })

  // Changing the trip length. Shortening deletes the later days and the meals
  // planned on them, so the "you will lose planned meals" question must be
  // answered from the server's current plan, not from this tab's cache: another
  // tab or device may have planned food on those days since we last read.
  // So: read fresh, decide from that read, then write. If the read fails,
  // nothing is written.
  //
  // The read calls the API directly, not through the query cache. A canceled
  // cache fetch resolves with the OLD cached data (React Query's revert), and
  // other food writes cancel this query, so a cached read could quietly
  // decide from the stale plan again.
  //
  // This keeps going if the view unmounts mid-read (the user tabbed out of
  // the box by leaving the view): they asked for the new length, and the
  // confirm text says what it is about.
  //
  // KNOWN GAP: a write from elsewhere between this read and our PUT is still
  // lost. Closing that needs a revision check on the write (SECURITY.md).
  const [checkingDays, setCheckingDays] = useState(false)
  async function changeDays(days: number, onSettled: () => void) {
    setCheckingDays(true)
    let current: ListFoodResponse
    try {
      current = await fetchListFood(listId)
    } catch {
      showToast("Couldn't load the latest food plan, so the trip length was not changed.", {
        type: 'error',
      })
      setCheckingDays(false)
      onSettled()
      return
    }
    setCheckingDays(false)
    if (
      days === current.dayCount ||
      (days < current.dayCount && losesWorkBelow(current, days) && !confirmTrim(days))
    ) {
      // No write. The fresh read may differ from the cache, so refresh it.
      invalidateFood()
      onSettled()
      return
    }
    foodDaysMut.mutate(days, { onSettled })
  }

  const dialogBusy =
    foodItemCreateMut.isPending ||
    foodItemUpdateMut.isPending ||
    foodItemDeleteMut.isPending
  const foodBusy = checkingDays || foodDaysMut.isPending || dialogBusy

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

  const food = listFoodQuery.data
  // A dialog opened from a slot that a refetch has since trimmed must not
  // open the editor with an id the grid cannot render. Same boundary rule as
  // the dialog's own live filtering; this covers the ids chosen BEFORE open.
  const slotIds = new Set(food.slots.map((slot) => slot.id))
  const dialogMode: FoodItemDialogMode | null =
    dialog === null
      ? null
      : dialog.kind === 'add'
        ? { kind: 'add', initialSlotIds: dialog.slotIds.filter((id) => slotIds.has(id)) }
        : editingItem
          ? { kind: 'edit', item: editingItem }
          : null

  return (
    <>
      <FoodDocument
        food={food}
        weightUnit={weightUnit}
        busy={foodBusy}
        onSetDays={(days, onSettled) => void changeDays(days, onSettled)}
        onOpenAdd={(ids) => openDialog({ kind: 'add', slotIds: ids })}
        onOpenEdit={(itemId) => openDialog({ kind: 'edit', itemId })}
      />
      {dialogMode && (
        <FoodItemDialog
          // Remount per open and per item: the dialog captures its draft and
          // diff baseline in state initializers (see FoodItemDialog).
          key={dialogMode.kind === 'edit' ? dialogMode.item.id : 'add'}
          mode={dialogMode}
          slots={food.slots}
          weightUnit={weightUnit}
          busy={dialogBusy}
          saveError={dialogError}
          anchorRef={dialogAnchorRef}
          onClose={closeDialog}
          onCreate={(input) => {
            setDialogError(null)
            // invalidateFood runs in the mutation's own onSuccess (which
            // TanStack fires before this per-call one). The per-call close is
            // dropped if the view unmounted mid-flight, which is fine - there
            // is no dialog left to close - and the seq guard keeps a stale
            // success from closing a dialog opened after this one.
            const seq = dialogSeq.current
            foodItemCreateMut.mutate(
              { input, seq },
              { onSuccess: () => { if (seq === dialogSeq.current) closeDialog() } },
            )
          }}
          onSave={(itemId, patch) => {
            setDialogError(null)
            const seq = dialogSeq.current
            foodItemUpdateMut.mutate(
              { itemId, patch, seq },
              { onSuccess: () => { if (seq === dialogSeq.current) closeDialog() } },
            )
          }}
          onDelete={(itemId) => {
            setDialogError(null)
            const seq = dialogSeq.current
            foodItemDeleteMut.mutate(
              { itemId, seq },
              { onSuccess: () => { if (seq === dialogSeq.current) closeDialog() } },
            )
          }}
        />
      )}
    </>
  )
}

// Asks before a shortening that deletes planned meals.
function confirmTrim(days: number): boolean {
  return window.confirm(
    `Shortening the trip to ${days} ${days === 1 ? 'day' : 'days'} removes ` +
      'the later meals, including what you had planned for them. ' +
      'Your food items stay on the list. Continue?',
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
  /** Called with the new length. The caller reads the current plan, asks
   *  before a shortening that loses planned meals, then writes. `onSettled`
   *  runs once that is over, whether it wrote, failed, or was declined. */
  onSetDays: (days: number, onSettled: () => void) => void
  /** Opens the add dialog with these slots preselected ([] from the header). */
  onOpenAdd: (slotIds: string[]) => void
  onOpenEdit: (itemId: string) => void
}

// The resolved food document: the planning header (trip length, food
// weight, add), then one column of day tables and, when needed, the
// Not-scheduled table. Only ever runs once FoodView's query gate above has
// confirmed real data - see the comment on that gate.
function FoodDocument({
  food,
  weightUnit,
  busy,
  onSetDays,
  onOpenAdd,
  onOpenEdit,
}: FoodDocumentProps) {
  // What the user has typed into the days box, or null to show the server's
  // length. The day write is not optimistic, so a typed number is only a
  // request: it is dropped once the write settles, and on every revert, so
  // the box never keeps showing a length the list does not have.
  const [daysDraft, setDaysDraft] = useState<string | null>(null)

  const itemsBySlot = new Map<string, ListFoodResponse['items']>()
  for (const item of food.items) {
    for (const slotId of item.slotIds) {
      const existing = itemsBySlot.get(slotId)
      if (existing) existing.push(item)
      else itemsBySlot.set(slotId, [item])
    }
  }

  const days = Array.from({ length: food.dayCount }, (_, i) => i + 1)
  // Items whose meals were all trimmed away (or never picked). They appear
  // in no day section, so without this group they would be unreachable, and
  // an item that lost its meals has to be repairable without deleting and
  // retyping it. Rendered even at zero days.
  const unscheduled = food.items.filter((item) => item.slotIds.length === 0)

  const totalFoodGrams = foodGramsFor(food.items)

  return (
    // mx-auto: this view has no sidebar, so without centering the capped
    // column hugs the left edge of the full-width shell.
    <div className="mx-auto mt-3 max-w-3xl space-y-3">
      <section
        aria-label="Food plan"
        className={`${FLAT_TABLE_SURFACE} flex flex-wrap items-center gap-x-5 gap-y-2 px-3 py-2.5 lg:px-4`}
      >
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <span>Trip length</span>
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
              // FoodView asks before a shortening that loses planned
              // meals, using a fresh read of the plan.
              onSetDays(next, () => setDaysDraft(null))
            }}
            // FORM_INPUT, not a private smaller box: the density doc records
            // how the food view's one-off field variant made it read like a
            // different app. w-16 fits the two digits FOOD_DAY_CAP allows.
            className={`w-16 ${FORM_INPUT} text-right tabular-nums`}
            aria-label="Trip length in days"
          />
          <span>days</span>
        </label>
        {/* Same label + value grammar as the Trip length control beside it:
            the same sans face and size, the value only darker and heavier,
            so the bar reads as one row of facts. One unit, following the
            g/oz toggle like every footer total. foodGramsFor sums items
            alone - never joined through slots, or a food eaten at several
            meals would count its weight once per meal. */}
        <div className="flex items-baseline gap-1.5 text-sm text-gray-600">
          <span>Food weight</span>
          <span className="font-semibold tabular-nums text-gray-900">
            {formatTotalWeight(totalFoodGrams, weightUnit)}
          </span>
        </div>
        <span className="flex-1" aria-hidden="true" />
        <PrimaryButton disabled={busy} onClick={() => onOpenAdd([])}>
          + Add food
        </PrimaryButton>
      </section>

      {food.dayCount === 0 ? (
        <p className="px-3 py-3 text-sm text-gray-500">
          Set a trip length and every meal appears. Add what you are eating
          and when; that is what you need to pack.
        </p>
      ) : (
        days.map((day) => (
          <FoodDaySection
            key={day}
            day={day}
            slots={slotsForDay(food, day)}
            itemsBySlot={itemsBySlot}
            weightUnit={weightUnit}
            busy={busy}
            onAddToSlots={onOpenAdd}
            onEditItem={onOpenEdit}
          />
        ))
      )}
      {unscheduled.length > 0 && (
        <section aria-label="Not scheduled" className={FLAT_TABLE_SURFACE}>
          <div className={`${FLAT_TABLE_HEADER} gap-2 ${FLAT_TABLE_HEADER_PADDING}`}>
            <h3 className={`shrink-0 ${FLAT_TABLE_HEADER_TITLE}`}>Not scheduled</h3>
            <span className={`min-w-0 flex-1 truncate ${FLAT_TABLE_META_TEXT} text-gray-500`}>
              carried, but no meal picked yet
            </span>
            <FoodPlanColumnLabels />
          </div>
          <div className="py-1">
            {unscheduled.map((item) => (
              <FoodPlanRow
                key={item.id}
                item={item}
                weightUnit={weightUnit}
                busy={busy}
                onEdit={onOpenEdit}
                indent={false}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
