import { ListPlus } from 'lucide-react'

type Props = {
  selectedCount: number
  /** Total number of selectable items currently in view. Used by the
   *  Select-all-vs-Select-none affordance to decide which to show. */
  selectableTotal: number
  onSelectAll: () => void
  onDeselectAll: () => void
  onCreateList: () => void
  onMoveToCategory: () => void
  onDelete: () => void
}

// Fixed bottom toolbar shown whenever bulk-select mode is on (regardless of
// selection count). With zero items selected the action buttons render
// disabled rather than hidden — the user can see the available actions
// before making a selection. The 300-item cap warning matches the per-list
// limit enforced server-side; Create list disables once that cap is
// exceeded.
//
// The Select-all / Select-none control is one-at-a-time: it shows "Select
// none" only when every selectable item is already selected (and there's
// at least one to select); otherwise "Select all". A partial selection
// shows "Select all" so clicking it completes the selection.
export default function BulkActionsToolbar({
  selectedCount,
  selectableTotal,
  onSelectAll,
  onDeselectAll,
  onCreateList,
  onMoveToCategory,
  onDelete,
}: Props) {
  const overListCap = selectedCount > 300
  const allSelected = selectableTotal > 0 && selectedCount >= selectableTotal
  const noneSelected = selectedCount === 0

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <span
          className={`text-sm tabular-nums ${
            overListCap
              ? 'rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700'
              : 'text-gray-600'
          }`}
        >
          {selectedCount} selected
          {overListCap && ' · max 300 per list'}
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
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onCreateList}
            disabled={noneSelected || overListCap}
            title={overListCap ? `Lists can hold at most 300 items (you've selected ${selectedCount})` : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <ListPlus size={14} /> Create list
          </button>
          <button
            onClick={onMoveToCategory}
            disabled={noneSelected}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            Move to category
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
