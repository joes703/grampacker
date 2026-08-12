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
  // Totals over the list's gear items.
  // is 0 until a plan is attached, so gear-only lists are unchanged.
  total: number
  packed: number
  onReset: () => void
  showUnpackedOnly: boolean
  onToggleShowUnpackedOnly: () => void
  showUnreadyOnly: boolean
  onToggleShowUnreadyOnly: () => void
  // Ready Checks block. Ready checks are ALWAYS on: there is no per-list
  // opt-in, so the second progress bar and the Reset ready button render
  // unconditionally. The `ready_checks_enabled` COLUMN still exists and is
  // now fully inert - not read, not written, not copied by duplication, not
  // on any DTO. See the note in ListDetailPage for why the column stays.
  // Prop is required because PackingProgress only renders for the owner
  // in pack mode — the share view (which never wires reset) does not
  // render this component.
  readyChecks: {
    ready: number
    total: number
    onResetReady: () => void
  }
}

// One progress metric: its filter switch, its count, its reset, its bar.
//
// The two metrics used to be laid out as a shared cluster of switches at the
// top of the panel and then two bars below, which left neither switch visibly
// attached to the thing it filtered. Each switch now sits on the same line as
// its own bar, immediately left of it, so "this control hides rows from THIS
// metric" is readable without inference.
//
// The visible label IS the accessible name (not a shortened caption beside a
// differently-worded aria-label): a mismatch there breaks speech control, and
// the name is what a user reads aloud to activate it.
function ProgressBlock({
  countLabel,
  doneLabel,
  resetLabel,
  done,
  pct,
  count,
  barClass,
  filterLabel,
  filterChecked,
  onFilterChange,
  onReset,
}: {
  countLabel: string
  doneLabel: string
  resetLabel: string
  done: boolean
  pct: number
  count: number
  barClass: string
  filterLabel: string
  filterChecked: boolean
  onFilterChange: () => void
  onReset: () => void
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
        <span className="text-sm font-medium tabular-nums text-gray-700">
          {countLabel}
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {done && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              {doneLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onReset}
            disabled={count === 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCcw size={12} /> {resetLabel}
          </button>
        </div>
      </div>
      {/* Switch and bar on one line, switch first. flex-wrap so a narrow
          panel drops the bar to its own line rather than crushing it; the
          bar keeps a min-width so it never degrades to a sliver first.
          The switch pair is print:hidden - a paper checklist has no
          filters - but the bar itself prints. */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <div className="flex shrink-0 items-center gap-2 print:hidden">
          <ToggleSwitch
            checked={filterChecked}
            onChange={onFilterChange}
            ariaLabel={filterLabel}
          />
          <span className={PANEL_TOGGLE_LABEL}>{filterLabel}</span>
        </div>
        <div className="h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-2 rounded-full transition-all ${barClass}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export default function PackingProgress({
  total,
  packed,
  onReset,
  showUnpackedOnly,
  onToggleShowUnpackedOnly,
  showUnreadyOnly,
  onToggleShowUnreadyOnly,
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
    <div className={`${TABLE_RADIUS} ${TABLE_BORDER} ${TABLE_SURFACE_BG} space-y-3 p-4`}>
      <ProgressBlock
        countLabel={`${packed} / ${total} packed`}
        doneLabel="All packed!"
        resetLabel="Reset packed"
        done={done}
        pct={pct}
        count={packed}
        barClass={done ? 'bg-green-500' : 'bg-blue-500'}
        filterLabel="Show unpacked only"
        filterChecked={showUnpackedOnly}
        onFilterChange={onToggleShowUnpackedOnly}
        onReset={() => setConfirmingReset(true)}
      />

      <ProgressBlock
        countLabel={`${readyCount} / ${readyTotal} ready`}
        doneLabel="All ready!"
        resetLabel="Reset ready"
        done={readyDone}
        pct={readyPct}
        count={readyCount}
        barClass={readyDone ? 'bg-green-500' : 'bg-amber-500'}
        filterLabel="Show un-ready only"
        filterChecked={showUnreadyOnly}
        onFilterChange={onToggleShowUnreadyOnly}
        onReset={() => setConfirmingResetReady(true)}
      />

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
