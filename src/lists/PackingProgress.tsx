import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import ConfirmDialog from '../components/ConfirmDialog'
import ToggleSwitch from '../components/ToggleSwitch'
import {
  PANEL_TOGGLE_LABEL,
  TABLE_BORDER,
  TABLE_RADIUS,
  TABLE_SURFACE_BG,
} from '../components/flat-table-styles'

type Props = {
  // COMBINED totals (design 8): gear items + packable foods. The food side
  // is 0 until a plan is attached, so gear-only lists are unchanged.
  total: number
  packed: number
  onReset: () => void
  showUnpackedOnly: boolean
  onToggleShowUnpackedOnly: () => void
  // Ready Checks block. Ready checks are ALWAYS on now: there is no
  // per-list opt-in, so the second progress bar and the Reset ready button
  // render unconditionally. The `ready_checks_enabled` column still exists
  // and is still copied by list duplication, but nothing reads it - see the
  // note in ListDetailPage where readyChecksEnabled is pinned true.
  // Prop is required because PackingProgress only renders for the owner
  // in pack mode — the share view (which never wires reset) does not
  // render this component.
  readyChecks: {
    ready: number
    // Gear-only denominator. Ready checks never cover food, so dividing by
    // the combined `total` above would make the ready bar uncompletable on
    // any list with a food plan.
    total: number
    onResetReady: () => void
  }
}

export default function PackingProgress({
  total,
  packed,
  onReset,
  showUnpackedOnly,
  onToggleShowUnpackedOnly,
  readyChecks,
}: Props) {
  const pct = total === 0 ? 0 : Math.round((packed / total) * 100)
  const done = packed === total && total > 0
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [confirmingResetReady, setConfirmingResetReady] = useState(false)
  const readyCount = readyChecks.ready
  const readyTotal = readyChecks.total
  const readyPct = readyTotal === 0 ? 0 : Math.round((readyCount / readyTotal) * 100)
  const readyDone = readyCount === readyTotal && readyTotal > 0

  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} p-4`}>
      {/* Pack-mode controls. One label-and-switch pair now that ready checks
          are always on; the pair sits inside a flex cluster so the label
          reads as adjacent to its control. ToggleSwitch renders a <button>
          (not an <input>), so wrapping in a <label> would be semantically
          wrong. The switch already carries its own ariaLabel. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
        <div className="flex items-center gap-2">
          <span className={PANEL_TOGGLE_LABEL}>Show unpacked only</span>
          <ToggleSwitch
            checked={showUnpackedOnly}
            onChange={onToggleShowUnpackedOnly}
            ariaLabel="Show unpacked only"
          />
        </div>
      </div>

      {/* Packed header — count on the left, "All packed!" chip + Reset
          packed on the right. */}
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
            disabled={packed === 0}
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

      {/* Ready bar — unconditional. Ready checks used to be a per-list opt-in
          whose toggle lived above; they are now simply part of pack mode. */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
          <span className="text-sm font-medium tabular-nums text-gray-700">
            {readyCount} / {readyTotal} ready
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
              disabled={readyCount === 0}
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
      {confirmingResetReady && (
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
