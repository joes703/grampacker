import { ListPlus } from 'lucide-react'

type Props = {
  selectedCount: number
  onSelectAll: () => void
  onDeselectAll: () => void
  onCreateList: () => void
  onMoveToCategory: () => void
  onDelete: () => void
}

// Fixed bottom toolbar shown in bulk-select mode. The 300-item cap warning
// matches the per-list limit enforced server-side; the Create-list button is
// disabled (with tooltip) once that cap is exceeded.
export default function BulkActionsToolbar({
  selectedCount,
  onSelectAll,
  onDeselectAll,
  onCreateList,
  onMoveToCategory,
  onDelete,
}: Props) {
  const overListCap = selectedCount > 300

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <span
          className={`text-sm ${
            overListCap
              ? 'rounded-md bg-red-50 px-2 py-0.5 font-medium text-red-700'
              : 'text-gray-600'
          }`}
        >
          {selectedCount} selected
          {overListCap && ' · max 300 per list'}
        </span>
        <button onClick={onSelectAll} className="text-sm text-blue-600 hover:underline">
          Select all
        </button>
        <button onClick={onDeselectAll} className="text-sm text-gray-500 hover:underline">
          Deselect all
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={onCreateList}
            disabled={overListCap}
            title={overListCap ? `Lists can hold at most 300 items (you've selected ${selectedCount})` : undefined}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
          >
            <ListPlus size={14} /> Create list
          </button>
          <button
            onClick={onMoveToCategory}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Move to category
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete ({selectedCount})
          </button>
        </div>
      </div>
    </div>
  )
}
