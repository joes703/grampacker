import { ListPlus, X } from 'lucide-react'
import { LIST_ITEM_CAP } from '../lib/caps'

type Props = {
  selectedCount: number
  /** Total number of selectable items currently in view. Used by the
   *  Select-all-vs-Select-none affordance to decide which to show. */
  selectableTotal: number
  onClose: () => void
  onSelectAll: () => void
  onDeselectAll: () => void
  onCreateList: () => void
  onMoveToCategory: () => void
  onDelete: () => void
}

// Sticky top action bar shown whenever bulk-select mode is on (regardless
// of selection count). Sits at the top of the gear list, below the page
// header; sticks to viewport top when scrolled. Replaces an earlier
// fixed-bottom toolbar — the bottom layout forced users to zigzag between
// bottom-left (Select all) and bottom-right (actions) for one logical task.
//
// Layout:
//   Desktop (≥md): single row. [✕] count [Select all/none] ··· [Move to category] [Create list] [Delete]
//   Mobile (<md): two rows. Top: [✕] count [Select all/none]. Bottom: action buttons.
//
// With zero items selected the action buttons render disabled rather than
// hidden — the user can see the available actions before making a
// selection. The LIST_ITEM_CAP cap warning matches the per-list limit
// enforced server-side; it appears (with a red badge) only when
// selectedCount > LIST_ITEM_CAP, and Create list disables once that cap
// is exceeded.
//
// The Select-all / Select-none control is one-at-a-time: it shows "Select
// none" only when every selectable item is already selected (and there's
// at least one to select); otherwise "Select all". A partial selection
// shows "Select all" so clicking it completes the selection.
//
// onClose exits selection mode AND clears the selection (Gmail / Apple
// Mail convention). The page header's separate Select/Cancel toggle stays
// as a secondary entry/exit point.
export default function BulkActionsToolbar({
  selectedCount,
  selectableTotal,
  onClose,
  onSelectAll,
  onDeselectAll,
  onCreateList,
  onMoveToCategory,
  onDelete,
}: Props) {
  const overListCap = selectedCount > LIST_ITEM_CAP
  const allSelected = selectableTotal > 0 && selectedCount >= selectableTotal
  const noneSelected = selectedCount === 0

  return (
    <div className="sticky top-0 z-40 -mx-4 mb-4 border-y border-gray-200 bg-white px-4 py-3">
      <div className="mx-auto max-w-7xl space-y-2 md:flex md:items-center md:gap-3 md:space-y-0">
        {/* Top row (always rendered): close, count, select-all toggle. On
            mobile this is the first row; on md+ it flows inline with the
            actions below via the parent's md:flex. */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Exit selection mode"
            className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={16} />
          </button>
          <span
            className={`text-sm tabular-nums ${
              overListCap
                ? 'rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700'
                : 'text-gray-600'
            }`}
          >
            {selectedCount} selected
            {overListCap && ` · max ${LIST_ITEM_CAP} per list`}
          </span>
          {allSelected ? (
            <button onClick={onDeselectAll} className="text-sm text-gray-500 hover:underline">
              Select none
            </button>
          ) : (
            <button
              onClick={onSelectAll}
              disabled={selectableTotal === 0}
              className="text-sm text-blue-600 hover:underline disabled:text-gray-300 disabled:hover:no-underline disabled:cursor-not-allowed"
            >
              Select all
            </button>
          )}
        </div>

        {/* Action cluster. On md+, ml-auto pushes it to the right of the
            shared row. On mobile it falls onto its own row via the parent's
            space-y-2. */}
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <button
            onClick={onMoveToCategory}
            disabled={noneSelected}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            Move to category
          </button>
          <button
            onClick={onCreateList}
            disabled={noneSelected || overListCap}
            title={overListCap ? `Lists can hold at most ${LIST_ITEM_CAP} items (you've selected ${selectedCount})` : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <ListPlus size={14} /> Create list
          </button>
          <button
            onClick={onDelete}
            disabled={noneSelected}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium tabular-nums text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-600"
          >
            Delete ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  )
}
