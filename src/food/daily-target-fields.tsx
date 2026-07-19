import { inputToKcalPerGram, kcalPerGramToInput } from './nutrition-format'
import type { DailyTargetMetric } from '../../shared/food-plans'
import type { ViewTargetMode } from './targets'
import type { WeightUnit } from '../lib/weight'

// Shared row model + field helpers for the two target editors (TargetsDialog
// and DefaultTargetsDialog). A Row holds the editor's STRING state; the
// bounds helpers convert to canonical numbers (kcal/g for density) on the
// way out and preserve untouched fields' stored canonical values.

export const DAILY_METRICS: { metric: DailyTargetMetric; label: string }[] = [
  { metric: 'calories', label: 'Calories' },
  { metric: 'protein', label: 'Protein (g)' },
  { metric: 'carbs', label: 'Carbs (g)' },
  { metric: 'fiber', label: 'Fiber (g)' },
  { metric: 'sodium', label: 'Sodium (mg)' },
  { metric: 'calorie_density', label: 'Calorie density' },
]
export const MODES: ViewTargetMode[] = ['off', 'min', 'max', 'range']
export type Row = { mode: ViewTargetMode; min: string; max: string }
export const EMPTY: Row = { mode: 'off', min: '', max: '' }
export const isPct = (m: string) => m === 'fat_pct' || m === 'sugar_pct'

type StoredBounds = { targetMin: number | null; targetMax: number | null }

// Seed a Row from a stored target (or EMPTY when the metric has no row -
// off IS the absence of the row). Density seeds through the display unit;
// the canonical value is preserved separately by outBounds.
export function seed(
  t: ({ mode: ViewTargetMode } & StoredBounds) | undefined,
  density: boolean,
  unit: WeightUnit,
): Row {
  if (!t) return EMPTY
  const f = (n: number | null) =>
    n === null ? '' : String(density ? Number(kcalPerGramToInput(n, unit).toFixed(2)) : n)
  return { mode: t.mode, min: f(t.targetMin), max: f(t.targetMax) }
}

// Parse a bound the user TYPED, landing on the 4-decimal-place storage
// scale (targetBoundSchema's round-trip refine): the density unit
// conversion - and free typing - can produce longer scales, which the
// server would 400. Only touched fields pass through here; untouched
// fields resubmit their stored canonical values via outBounds, which are
// already scale-clean.
export function num(s: string, density: boolean, unit: WeightUnit): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const canonical = density ? inputToKcalPerGram(n, unit) : n
  return Math.round(canonical * 10_000) / 10_000
}

// Per-FIELD canonical preservation (I-CANONICAL). A field whose string the
// user did not touch reuses the STORED canonical value instead of re-parsing
// the rounded display string. This is what stops calorie-density drift on a
// full-replace save: every stored row is resubmitted, so an untouched bound
// re-parsed from its 2dp display would silently corrupt the canonical kcal/g.
export function outBounds(
  row: Row,
  initRow: Row,
  stored: StoredBounds | undefined,
  density: boolean,
  unit: WeightUnit,
): { min: number | null; max: number | null } {
  const field = (cur: string, was: string, storedVal: number | null) =>
    cur === was ? storedVal : num(cur, density, unit)
  const min =
    row.mode === 'off' || row.mode === 'max'
      ? null
      : field(row.min, initRow.min, stored?.targetMin ?? null)
  const max =
    row.mode === 'off' || row.mode === 'min'
      ? null
      : field(row.max, initRow.max, stored?.targetMax ?? null)
  return { min, max }
}

// Inline error string (mirrors zod's I-BOUNDS / I-PCT / magnitude) or null
// when valid. Numeric checks run on the outBounds result - the ACTUAL values
// the payload will carry - because a preserved canonical bound and its
// re-parsed 2dp display string can straddle a comparison (e.g. stored density
// min 4.2333 displays as a string that re-parses to 4.2332): validating the
// display strings would enable Save on a payload the server rejects.
export function rowError(
  metric: string,
  row: Row,
  initRow: Row,
  stored: StoredBounds | undefined,
  density: boolean,
  unit: WeightUnit,
): string | null {
  if (row.mode === 'off') return null
  const need = (s: string) => {
    const n = Number(s)
    return s.trim() !== '' && Number.isFinite(n)
  }
  if (row.mode === 'min' && !need(row.min)) return 'Enter a minimum'
  if (row.mode === 'max' && !need(row.max)) return 'Enter a maximum'
  if (row.mode === 'range' && (!need(row.min) || !need(row.max))) {
    return 'Enter both bounds'
  }
  const b = outBounds(row, initRow, stored, density, unit)
  if ((b.min !== null && b.min < 0) || (b.max !== null && b.max < 0)) {
    return 'Must be 0 or more'
  }
  if (
    (b.min !== null && b.min >= 100_000_000) ||
    (b.max !== null && b.max >= 100_000_000)
  ) {
    return 'Must be less than 100,000,000'
  }
  if (
    isPct(metric) &&
    ((b.min !== null && b.min > 100) || (b.max !== null && b.max > 100))
  ) {
    return 'Percent must be <= 100'
  }
  if (row.mode === 'range' && b.min !== null && b.max !== null && b.min > b.max) {
    return 'Min must be <= max'
  }
  return null
}

export function MetricRow({
  id,
  label,
  row,
  error,
  onChange,
}: {
  id: string
  label: string
  row: Row
  error: string | null
  onChange: (r: Row) => void
}) {
  const errId = `${id}-err`
  const invalid = error ? true : undefined
  const describedBy = error ? errId : undefined
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-40 shrink-0 text-gray-600">{label}</span>
        <select
          aria-label={`${label} mode`}
          value={row.mode}
          onChange={(e) => onChange({ ...row, mode: e.target.value as ViewTargetMode })}
          className="rounded border border-gray-300 px-2 py-1"
        >
          {MODES.map((m) => (
            <option key={m} value={m}>
              {m === 'off' ? 'Off' : m.charAt(0).toUpperCase() + m.slice(1)}
            </option>
          ))}
        </select>
        <input
          aria-label={`${label} minimum`}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          inputMode="decimal"
          placeholder="min"
          value={row.min}
          disabled={row.mode === 'off' || row.mode === 'max'}
          onChange={(e) => onChange({ ...row, min: e.target.value })}
          className="w-20 rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100"
        />
        <input
          aria-label={`${label} maximum`}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          inputMode="decimal"
          placeholder="max"
          value={row.max}
          disabled={row.mode === 'off' || row.mode === 'min'}
          onChange={(e) => onChange({ ...row, max: e.target.value })}
          className="w-20 rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100"
        />
      </div>
      {error && (
        <p id={errId} className="ml-40 pl-2 text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  )
}
