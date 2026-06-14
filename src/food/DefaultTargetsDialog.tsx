import { useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { useWeightUnit } from '../lib/use-weight-unit'
import {
  DAILY_METRICS, EMPTY, MetricRow, seed, outBounds, rowError, type Row,
} from './daily-target-fields'
import type { TargetDefault, DailyTargetMetric, TargetMode } from '../lib/types'
import type { DefaultsSavePayload } from '../lib/queries/target-defaults'

export default function DefaultTargetsDialog({
  defaults, saving = false, onSave, onClose,
}: {
  defaults: TargetDefault[]
  saving?: boolean; onSave: (payload: DefaultsSavePayload) => void; onClose: () => void
}) {
  const { weightUnit } = useWeightUnit()
  // Freeze the opening unit and baseline rows ONCE (lazy initializer). A later
  // unit toggle or query refetch cannot retroactively shift the baseline or the
  // conversion factor, which would otherwise round-trip (corrupt) canonical
  // calorie-density values. Every conversion below uses snapshot.unit.
  const [snapshot] = useState(() => {
    const unit = weightUnit
    const by = new Map(defaults.map((t) => [t.metric, t]))
    const rows = Object.fromEntries(
      DAILY_METRICS.map(({ metric }) => [metric, seed(by.get(metric), metric === 'calorie_density', unit)]),
    ) as Record<string, Row>
    return { unit, by, rows }
  })
  const { unit } = snapshot
  const [rows, setRows] = useState(snapshot.rows)
  const dirty = (a: Row, b: Row) => a.mode !== b.mode || a.min !== b.min || a.max !== b.max

  const errors = DAILY_METRICS.map(({ metric }) =>
    rowError(metric, rows[metric] ?? EMPTY, metric === 'calorie_density', unit)).filter(Boolean)
  const canSave = errors.length === 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const payload: DefaultsSavePayload = { upserts: [], deletes: [] }
    for (const { metric } of DAILY_METRICS) {
      const initRow = snapshot.rows[metric] ?? EMPTY
      const row = rows[metric] ?? EMPTY
      if (!dirty(row, initRow)) continue
      if (row.mode === 'off') { if (snapshot.by.get(metric)) payload.deletes.push(metric as DailyTargetMetric); continue }
      const b = outBounds(row, initRow, snapshot.by.get(metric), metric === 'calorie_density', unit)
      payload.upserts.push({ metric, mode: row.mode as Exclude<TargetMode, 'off'>, target_min: b.min, target_max: b.max })
    }
    onSave(payload)
  }

  const densityLabel = unit === 'oz' ? 'kcal/oz' : 'kcal/g'
  return (
    <Modal open onClose={onClose} title="Default daily targets" className="w-[calc(100vw-2rem)] max-w-lg">
      <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
        <p className="text-sm text-gray-600">
          These defaults are copied into each new food plan you create. Editing them does not change plans you already have.
        </p>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-gray-900">Daily targets</legend>
          {DAILY_METRICS.map(({ metric, label }) => (
            <MetricRow key={metric} id={`default-${metric}`}
              label={metric === 'calorie_density' ? `Calorie density (${densityLabel})` : label}
              row={rows[metric] ?? EMPTY} error={rowError(metric, rows[metric] ?? EMPTY, metric === 'calorie_density', unit)}
              onChange={(r) => setRows((s) => ({ ...s, [metric]: r }))} />
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <PrimaryButton type="submit" disabled={saving || !canSave}>{saving ? 'Saving...' : 'Save defaults'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
