import { useMemo, useState } from 'react'
import { Check, Copy, Search } from 'lucide-react'
import type { FoodPlanSummary } from '../../shared/food-plans'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_ROW,
} from '../components/flat-table-styles'
import PickerEmptyState from './PickerEmptyState'

type Props = {
  plans: FoodPlanSummary[]
  // An empty `plans` means "you have no plans" ONLY once the request has
  // settled. While it is in flight, or if it failed, the array is empty for a
  // reason that has nothing to do with the user, and saying "No food plans yet"
  // would be telling someone with plans to go and build one.
  isPending: boolean
  isError: boolean
  attachedPlanId: string | null
  busy: boolean
  onAttach: (planId: string) => void
  onDetach: () => void
  // A plan already backing ANOTHER list cannot be attached (one plan per
  // trip); selecting it duplicates the plan and attaches the COPY here.
  onDuplicateAttach: (planId: string) => void
}

// The Food half of the library panel's Gear | Food toggle.
//
// The verb is deliberately different from Gear's (design 8): gear is "add many
// items", food is "pick THE one plan for this trip". So this is single-select -
// clicking a plan attaches it and replaces whatever was attached, and clicking
// the attached plan detaches it. There is no multi-add, because a list has one
// food_plan_id.
//
// One plan per trip (design 3): a plan already in use by another list renders
// with "In use by <name>" and selecting it runs Duplicate & attach instead of
// stealing the link - the other trip keeps its plan, this one gets its own
// copy. usedByList* ride on the summaries, so a plan attached from another tab
// flips state on the next summaries refetch (and an attach that loses that
// race gets a 409 + refetch from useFoodPlanLink).
export default function FoodPlanPicker({
  plans,
  isPending,
  isError,
  attachedPlanId,
  busy,
  onAttach,
  onDetach,
  onDuplicateAttach,
}: Props) {
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()

  const filtered = useMemo(() => {
    const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder)
    if (!q) return sorted
    return sorted.filter((p) => p.name.toLowerCase().includes(q))
  }, [plans, q])

  return (
    <div className="flex h-full flex-col">
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="search"
            placeholder="Search food plans…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 ${FLAT_TABLE_BODY_TEXT} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isPending ? (
          <PickerEmptyState heading="Loading food plans…" />
        ) : isError ? (
          <PickerEmptyState
            heading="Couldn't load your food plans."
            body="Check your connection and reopen this panel."
          />
        ) : filtered.length === 0 ? (
          // Mirrors the gear side: plans are built on the Food page, so say
          // where they live rather than offering to create one here.
          <PickerEmptyState
            heading={plans.length === 0 ? 'No food plans yet.' : 'No matching plans.'}
            body="Build one on the Food page, then return here."
          />
        ) : (
          <ul>
            {filtered.map((plan) => {
              const attached = plan.id === attachedPlanId
              // The attached plan's usedByList is THIS list, so "in use
              // elsewhere" is exactly used-and-not-attached-here.
              const inUseElsewhere = !attached && plan.usedByListId !== null
              return (
                <li key={plan.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      attached
                        ? onDetach()
                        : inUseElsewhere
                          ? onDuplicateAttach(plan.id)
                          : onAttach(plan.id)
                    }
                    aria-pressed={attached}
                    className={`${FLAT_TABLE_ROW} w-full text-left flex items-center gap-2 disabled:opacity-50 ${
                      attached ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate ${FLAT_TABLE_BODY_TEXT}`}>{plan.name}</span>
                      <span className={`block truncate ${FLAT_TABLE_META_TEXT}`}>
                        {plan.dayCount} {plan.dayCount === 1 ? 'day' : 'days'} ·{' '}
                        {plan.entryCount} {plan.entryCount === 1 ? 'food' : 'foods'}
                        {inUseElsewhere && ` · In use by ${plan.usedByListName}`}
                      </span>
                    </span>
                    {attached && (
                      <Check size={16} className="shrink-0 text-blue-700" aria-hidden />
                    )}
                    {inUseElsewhere && (
                      <span
                        className={`shrink-0 flex items-center gap-1 ${FLAT_TABLE_META_TEXT}`}
                        aria-hidden
                      >
                        <Copy size={14} />
                        Duplicate &amp; attach
                      </span>
                    )}
                    <span className="sr-only">
                      {attached
                        ? 'Attached. Select to remove from this list.'
                        : inUseElsewhere
                          ? 'In use by another list. Select to duplicate this plan and attach the copy here.'
                          : 'Use for this list'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
