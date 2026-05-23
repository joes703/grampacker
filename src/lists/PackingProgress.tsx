import { useState } from 'react'
import { RotateCcw, WifiOff } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import ToggleSwitch from '../components/ToggleSwitch'
import { TABLE_BORDER, TABLE_RADIUS, TABLE_SURFACE_BG } from '../components/flat-table-styles'

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
  // Ready Checks block. Always supplied so the bottom options row can
  // render the toggle; the Ready progress bar + Reset Ready only render
  // when `enabled`. The toggle flips ready_checks_enabled via the page-
  // level mutation passed as onToggleEnabled.
  readyChecks?: {
    ready: number
    enabled: boolean
    onToggleEnabled: () => void
    onResetReady: () => void
  }
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
  readyChecks,
}: Props) {
  const pct = total === 0 ? 0 : Math.round((packed / total) * 100)
  const done = packed === total && total > 0
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [confirmingResetReady, setConfirmingResetReady] = useState(false)
  const readyCount = readyChecks?.ready ?? 0
  const readyPct = total === 0 ? 0 : Math.round((readyCount / total) * 100)
  const readyDone = readyChecks?.enabled === true && readyCount === total && total > 0

  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} p-4`}>
      {/* Packed header — count on the left, "All packed!" chip + Reset
          packed on the right. View toggles (Show unpacked only, Ready
          checks) live below in the options row so this row stays focused
          on the Packed progress + its reset action. */}
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
            onClick={() => setConfirmingReset(true)}
            disabled={packed === 0 || offline}
            title={offline ? 'Offline. Reconnect to reset packed state.' : undefined}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={12} /> Reset packed
          </button>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-2 rounded-full transition-all ${done ? 'bg-green-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {readyChecks?.enabled && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <span className="text-sm font-medium tabular-nums text-gray-700">
              {readyCount} / {total} ready
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {readyDone && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  All ready!
                </span>
              )}
              <button
                type="button"
                onClick={() => setConfirmingResetReady(true)}
                disabled={readyCount === 0 || offline}
                title={offline ? 'Offline. Reconnect to reset ready state.' : undefined}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw size={12} /> Reset ready
              </button>
            </div>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={`h-2 rounded-full transition-all ${readyDone ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${readyPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Options block — Pack Mode view toggles grouped under the
          progress bars. Rendered as a shrink-to-content grid (label
          column + switch column, both `max-content`) so each switch
          sits right next to its label rather than pinned to the far
          right of the wide progress panel. Switches still align
          vertically with each other because both rows share the same
          two grid columns. Behavior unchanged: Show unpacked only is
          local view state, Ready checks writes ready_checks_enabled
          via the same page mutation, both toggles stay enabled
          offline. */}
      <div className="mt-4 grid grid-cols-[max-content_max-content] gap-x-3 gap-y-2 items-center print:hidden">
        <span className="text-sm font-medium text-gray-700">Show unpacked only</span>
        <ToggleSwitch
          checked={showUnpackedOnly}
          onChange={onToggleShowUnpackedOnly}
          ariaLabel="Show unpacked only"
        />
        {readyChecks && (
          <>
            <span className="text-sm font-medium text-gray-700">Ready checks</span>
            <ToggleSwitch
              checked={readyChecks.enabled}
              onChange={readyChecks.onToggleEnabled}
              ariaLabel="Ready checks"
            />
          </>
        )}
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
              ? 'Syncing pack-mode checkmarks...'
              : offline
                ? 'Offline. Pack-mode checkmarks will sync when you reconnect.'
                : syncBlocked
                  ? `Couldn't sync ${pendingSyncCount} pack-mode ${pendingSyncCount === 1 ? 'change' : 'changes'}.`
                  : `${pendingSyncCount} pack-mode ${pendingSyncCount === 1 ? 'change is' : 'changes are'} waiting to sync.`}
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
      {confirmingResetReady && readyChecks && (
        <ConfirmDialog
          title="Reset ready?"
          message="All items will be marked not ready. This won't change packed checkmarks, your inventory, weights, or quantities."
          confirmLabel="Reset"
          onCancel={() => setConfirmingResetReady(false)}
          onConfirm={() => {
            setConfirmingResetReady(false)
            readyChecks.onResetReady()
          }}
        />
      )}
    </div>
  )
}
