import { inputToKcalPerGram, kcalPerGramToInput } from './nutrition-format'
import type { TargetMode, DailyTargetMetric } from '../lib/types'

export const DAILY_METRICS: { metric: DailyTargetMetric; label: string }[] = [
  { metric: 'calories', label: 'Calories' }, { metric: 'protein', label: 'Protein (g)' },
  { metric: 'carbs', label: 'Carbs (g)' }, { metric: 'fiber', label: 'Fiber (g)' },
  { metric: 'sodium', label: 'Sodium (mg)' }, { metric: 'calorie_density', label: 'Calorie density' },
]
export const MODES: TargetMode[] = ['off', 'min', 'max', 'range']
export type Row = { mode: TargetMode; min: string; max: string }
export const EMPTY: Row = { mode: 'off', min: '', max: '' }
export const isPct = (m: string) => m === 'fat_pct' || m === 'sugar_pct'

export function seed(t: { mode: TargetMode; target_min: number | null; target_max: number | null } | undefined, density: boolean, unit: 'oz' | 'g'): Row {
  if (!t) return EMPTY
  const f = (n: number | null) => n == null ? '' : String(density ? Number(kcalPerGramToInput(n, unit).toFixed(2)) : n)
  return { mode: t.mode, min: f(t.target_min), max: f(t.target_max) }
}
export function num(s: string, density: boolean, unit: 'oz' | 'g'): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return density ? inputToKcalPerGram(n, unit) : n
}
export function bounds(row: Row, density: boolean, unit: 'oz' | 'g'): { min: number | null; max: number | null } {
  if (row.mode === 'off') return { min: null, max: null }
  if (row.mode === 'min') return { min: num(row.min, density, unit), max: null }
  if (row.mode === 'max') return { min: null, max: num(row.max, density, unit) }
  return { min: num(row.min, density, unit), max: num(row.max, density, unit) }
}
// Per-FIELD canonical preservation. A field the user did not touch reuses the
// stored canonical value instead of re-deriving it from the rounded display
// string. This is what stops calorie-density drift when only ONE bound changes:
// row-level dirty tracking alone would resubmit the untouched bound's rounded
// value and corrupt it. `stored` is the canonical (kcal/g) value from the DB.
export function outBounds(
  row: Row, initRow: Row, stored: { target_min: number | null; target_max: number | null } | undefined,
  density: boolean, unit: 'oz' | 'g',
): { min: number | null; max: number | null } {
  const field = (cur: string, was: string, storedVal: number | null) =>
    cur === was ? storedVal : num(cur, density, unit)
  const min = row.mode === 'off' || row.mode === 'max' ? null : field(row.min, initRow.min, stored?.target_min ?? null)
  const max = row.mode === 'off' || row.mode === 'min' ? null : field(row.max, initRow.max, stored?.target_max ?? null)
  return { min, max }
}
// Inline error string (mirrors the DB CHECKs) or null when the row is valid.
export function rowError(metric: string, row: Row, density: boolean, unit: 'oz' | 'g'): string | null {
  if (row.mode === 'off') return null
  const need = (s: string) => { const n = Number(s); return s.trim() !== '' && Number.isFinite(n) }
  if (row.mode === 'min' && !need(row.min)) return 'Enter a minimum'
  if (row.mode === 'max' && !need(row.max)) return 'Enter a maximum'
  if (row.mode === 'range' && (!need(row.min) || !need(row.max))) return 'Enter both bounds'
  const b = bounds(row, density, unit)
  if ((b.min != null && b.min < 0) || (b.max != null && b.max < 0)) return 'Must be 0 or more'
  if (isPct(metric) && ((b.min != null && b.min > 100) || (b.max != null && b.max > 100))) return 'Percent must be <= 100'
  if (row.mode === 'range' && b.min != null && b.max != null && b.min > b.max) return 'Min must be <= max'
  return null
}

export function MetricRow({ id, label, row, error, onChange }: { id: string; label: string; row: Row; error: string | null; onChange: (r: Row) => void }) {
  const errId = `${id}-err`
  const invalid = error ? true : undefined
  const describedBy = error ? errId : undefined
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className="w-40 shrink-0 text-gray-600">{label}</span>
        <select aria-label={`${label} mode`} value={row.mode} onChange={(e) => onChange({ ...row, mode: e.target.value as TargetMode })} className="rounded border border-gray-300 px-2 py-1">
          {MODES.map((m) => <option key={m} value={m}>{m === 'off' ? 'Off' : m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
        </select>
        <input aria-label={`${label} minimum`} aria-invalid={invalid} aria-describedby={describedBy} inputMode="decimal" placeholder="min" value={row.min}
          disabled={row.mode === 'off' || row.mode === 'max'} onChange={(e) => onChange({ ...row, min: e.target.value })}
          className="w-20 rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100" />
        <input aria-label={`${label} maximum`} aria-invalid={invalid} aria-describedby={describedBy} inputMode="decimal" placeholder="max" value={row.max}
          disabled={row.mode === 'off' || row.mode === 'min'} onChange={(e) => onChange({ ...row, max: e.target.value })}
          className="w-20 rounded border border-gray-300 px-2 py-1 disabled:bg-gray-100" />
      </div>
      {error && <p id={errId} className="ml-40 pl-2 text-xs text-rose-600">{error}</p>}
    </div>
  )
}
