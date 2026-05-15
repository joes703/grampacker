import { useState } from 'react'
import { RotateCcw, WifiOff } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'

type Props = {
  total: number
  packed: number
  onReset: () => void
  showUnpackedOnly: boolean
  onToggleShowUnpackedOnly: () => void
  // True when navigator.onLine is false. Surfaces a contextual capability-
  // boundary message and disables Reset since it would fail. Individual
  // checkmarks still work offline and sync later. The Unpacked-only toggle
  // stays enabled because it's local view state.
  offline?: boolean
  pendingSyncCount?: number
  syncing?: boolean
  // True after a sync attempt errored. The auto-retry-on-reconnect path
  // still runs (the page-level effect clears this on offline), but until
  // then we surface a manual Retry affordance so a transient server error
  // doesn't strand the user waiting for an offline transition.
  syncBlocked?: boolean
  onRetrySync?: () => void
}

export default function PackingProgress({
  total,
  packed,
  onReset,
  showUnpackedOnly,
  onToggleShowUnpackedOnly,
  offline = false,
  pendingSyncCount = 0,
  syncing = false,
  syncBlocked = false,
  onRetrySync,
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
            title={showUnpackedOnly ? 'Showing unpacked only. Click to show all.' : 'Show unpacked only'}
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
            onClick={() => setConfirmingReset(true)}
            disabled={packed === 0 || offline}
            title={offline ? 'Offline. Reconnect to reset packed state.' : undefined}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
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
      {(offline || pendingSyncCount > 0 || syncing) && (
        <div
          role="status"
          aria-live="polite"
          className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 border border-amber-200"
        >
          <WifiOff size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span className="flex-1">
            {syncing
              ? 'Syncing packing checkmarks...'
              : offline
                ? 'Offline. Packing checkmarks will sync when you reconnect.'
                : syncBlocked
                  ? `Couldn't sync ${pendingSyncCount} packing ${pendingSyncCount === 1 ? 'checkmark' : 'checkmarks'}.`
                  : `${pendingSyncCount} packing ${pendingSyncCount === 1 ? 'checkmark is' : 'checkmarks are'} waiting to sync.`}
          </span>
          {syncBlocked && !offline && !syncing && onRetrySync && (
            <button
              type="button"
              onClick={onRetrySync}
              className="shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {confirmingReset && (
        // Reset is recoverable (just clears is_packed flags), so the confirm
        // uses ConfirmDialog's default neutral styling — no `dangerous` flag.
        <ConfirmDialog
          title="Reset packing?"
          message="All items will be marked unpacked. This won't change your inventory, weights, or quantities."
          confirmLabel="Reset"
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
