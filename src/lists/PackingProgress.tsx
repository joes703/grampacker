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
  total: number
  packed: number
  onReset: () => void
  showUnpackedOnly: boolean
  onToggleShowUnpackedOnly: () => void
  // Ready Checks block. The "Add ready checks" toggle lives inline at the
  // top of this panel — it's the only place pack-mode options live now
  // that List options is hidden in pack mode. `enabled` still drives the
  // second progress bar + Reset Ready button; toggling persists via
  // `onToggleEnabled` (writes ready_checks_enabled on the lists row).
  // Prop is required because PackingProgress only renders for the owner
  // in pack mode — the share view (which never wires reset/toggle) does
  // not render this component.
  readyChecks: {
    ready: number
    enabled: boolean
    onResetReady: () => void
    onToggleEnabled: () => void
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
  const readyPct = total === 0 ? 0 : Math.round((readyCount / total) * 100)
  const readyDone = readyChecks.enabled && readyCount === total && total > 0

  return (
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} p-4`}>
      {/* Pack-mode controls. Compact inline cluster of label-and-switch
          pairs (each label sits adjacent to its switch so they read as
          one control), gap-x-5 between clusters, flex-wrap so mobile
          stacks the two when the panel is narrow. The cluster is anchored
          left, not stretched edge-to-edge — the switches were never meant
          to fight each other across a wide desktop panel.
          Show unpacked only: local view state.
          Add ready checks: persists ready_checks_enabled. This is the
          only surface that toggles this setting now that List options
          is suppressed in pack mode. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 print:hidden">
        {/* Each label-and-switch pair sits inside a flex cluster so the
            label reads as adjacent to its control. ToggleSwitch renders
            a <button> (not an <input>), so wrapping in a <label> would
            be semantically wrong. The switch already carries its own
            ariaLabel. */}
        <div className="flex items-center gap-2">
          <span className={PANEL_TOGGLE_LABEL}>Show unpacked only</span>
          <ToggleSwitch
            checked={showUnpackedOnly}
            onChange={onToggleShowUnpackedOnly}
            ariaLabel="Show unpacked only"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className={PANEL_TOGGLE_LABEL}>Add ready checks</span>
          <ToggleSwitch
            checked={readyChecks.enabled}
            onChange={readyChecks.onToggleEnabled}
            ariaLabel="Add ready checks"
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

      {readyChecks.enabled && (
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
