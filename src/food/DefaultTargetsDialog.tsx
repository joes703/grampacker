import { useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { useWeightUnit } from '../lib/use-weight-unit'
import {
  saveTargetDefaultsRequestSchema,
  type DailyTargetMetric,
  type SaveTargetDefaultsRequest,
  type TargetDefault,
} from '../../shared/food-plans'
import {
  DAILY_METRICS,
  EMPTY,
  MetricRow,
  outBounds,
  rowError,
  seed,
  type Row,
} from './daily-target-fields'

// Account-level default daily targets editor. Same full-replace contract as
// TargetsDialog: submit carries every row whose mode is not Off, with
// untouched fields resubmitting their stored canonical values (I-CANONICAL).
export default function DefaultTargetsDialog({
  defaults,
  saving = false,
  saveError,
  onSave,
  onClose,
}: {
  defaults: TargetDefault[]
  saving?: boolean
  saveError: string | null
  onSave: (payload: SaveTargetDefaultsRequest) => void
  onClose: () => void
}) {
  const { weightUnit } = useWeightUnit()
  // Freeze the opening unit and baseline rows ONCE (lazy initializer): a
  // later unit toggle or query refetch cannot shift the baseline or the
  // conversion factor, which would otherwise round-trip (corrupt) canonical
  // calorie-density values. Every conversion below uses snapshot.unit.
  const [snapshot] = useState(() => {
    const unit = weightUnit
    const by = new Map(defaults.map((t) => [t.metric, t]))
    const rows = Object.fromEntries(
      DAILY_METRICS.map(({ metric }) => [
        metric,
        seed(by.get(metric), metric === 'calorie_density', unit),
      ]),
    ) as Record<string, Row>
    return { unit, by, rows }
  })
  const { unit } = snapshot
  const [rows, setRows] = useState(snapshot.rows)

  const error = (metric: DailyTargetMetric, row: Row) =>
    rowError(
      metric,
      row,
      snapshot.rows[metric] ?? EMPTY,
      snapshot.by.get(metric),
      metric === 'calorie_density',
      unit,
    )

  function buildPayload(): SaveTargetDefaultsRequest {
    const payload: SaveTargetDefaultsRequest = { defaults: [] }
    for (const { metric } of DAILY_METRICS) {
      const row = rows[metric] ?? EMPTY
      if (row.mode === 'off') continue
      const initRow = snapshot.rows[metric] ?? EMPTY
      const b = outBounds(
        row,
        initRow,
        snapshot.by.get(metric),
        metric === 'calorie_density',
        unit,
      )
      payload.defaults.push({ metric, mode: row.mode, targetMin: b.min, targetMax: b.max })
    }
    return payload
  }

  const errors = DAILY_METRICS.map(({ metric }) =>
    error(metric, rows[metric] ?? EMPTY),
  ).filter(Boolean)
  // Backstop: the actual payload must pass the server's zod contract, so no
  // rowError blind spot can enable Save on a request the PUT would 400.
  const canSave =
    errors.length === 0 && saveTargetDefaultsRequestSchema.safeParse(buildPayload()).success

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    onSave(buildPayload())
  }

  const densityLabel = unit === 'oz' ? 'kcal/oz' : 'kcal/g'
  return (
    <Modal
      open
      // A full-replace save must not race a second one: block Escape/backdrop
      // dismissal while the PUT is in flight (Cancel below is disabled too).
      onClose={() => {
        if (!saving) onClose()
      }}
      title="Default daily targets"
      className="w-[calc(100vw-2rem)] max-w-lg"
      closeOnBackdropClick={false}
    >
      <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto p-6" noValidate>
        <h2 className="text-base font-semibold text-gray-900">Default daily targets</h2>
        <p className="text-sm text-gray-600">
          These defaults are copied into each new food plan you create. Editing
          them does not change plans you already have.
        </p>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-gray-900">Daily targets</legend>
          {DAILY_METRICS.map(({ metric, label }) => (
            <MetricRow
              key={metric}
              id={`default-${metric}`}
              label={metric === 'calorie_density' ? `Calorie density (${densityLabel})` : label}
              row={rows[metric] ?? EMPTY}
              error={error(metric, rows[metric] ?? EMPTY)}
              onChange={(r) => setRows((s) => ({ ...s, [metric]: r }))}
            />
          ))}
        </fieldset>
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={saving || !canSave}>
            {saving ? 'Saving…' : 'Save defaults'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
