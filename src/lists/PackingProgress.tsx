import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'

type Props = {
  total: number
  packed: number
  onReset: () => void
  showUnpackedOnly: boolean
  onToggleShowUnpackedOnly: () => void
  groupWorn: boolean
  onToggleGroupWorn: () => void
}

export default function PackingProgress({
  total,
  packed,
  onReset,
  showUnpackedOnly,
  onToggleShowUnpackedOnly,
  groupWorn,
  onToggleGroupWorn,
}: Props) {
  const pct = total === 0 ? 0 : Math.round((packed / total) * 100)
  const done = packed === total && total > 0
  const [confirmingReset, setConfirmingReset] = useState(false)

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {/* The control cluster wraps on narrow viewports so three toggles
          plus the optional "All packed!" chip don't horizontally squeeze
          on a 375 px screen. */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <span className="text-sm font-medium tabular-nums text-gray-700">
          {packed} / {total} packed
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {done && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              All packed!
            </span>
          )}
          <button
            type="button"
            onClick={onToggleShowUnpackedOnly}
            aria-pressed={showUnpackedOnly}
            title={showUnpackedOnly ? 'Showing unpacked only — click to show all' : 'Show unpacked only'}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              showUnpackedOnly
                ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Unpacked only
          </button>
          <button
            type="button"
            onClick={onToggleGroupWorn}
            aria-pressed={groupWorn}
            title={groupWorn ? 'Worn items grouped at the bottom — click to merge back into categories' : 'Group worn items at the bottom (mirrors gear that sits by the door)'}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${
              groupWorn
                ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Group worn
          </button>
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            disabled={packed === 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-2 rounded-full transition-all ${done ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {confirmingReset && (
        <ConfirmDialog
          title="Reset packing?"
          message="All items will be marked unpacked. This won't change your inventory, weights, or quantities."
          confirmLabel="Reset"
          dangerous
          onCancel={() => setConfirmingReset(false)}
          onConfirm={() => {
            setConfirmingReset(false)
            onReset()
          }}
        />
      )}
    </div>
  )
}
