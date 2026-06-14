import { useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useWeightUnit } from '../lib/use-weight-unit'
import { inputToKcalPerGram, kcalPerGramToInput } from './nutrition-format'
import type {
  FoodPlan, Meal, FoodPlanDailyTarget, MealTarget, TargetMode, DailyTargetMetric, MealTargetMetric,
} from '../lib/types'
import type { TargetsSavePayload } from '../lib/queries/food-plan'

const DAILY_METRICS: { metric: DailyTargetMetric; label: string }[] = [
  { metric: 'calories', label: 'Calories' }, { metric: 'protein', label: 'Protein (g)' },
  { metric: 'carbs', label: 'Carbs (g)' }, { metric: 'fiber', label: 'Fiber (g)' },
  { metric: 'sodium', label: 'Sodium (mg)' }, { metric: 'calorie_density', label: 'Calorie density' },
]
const MEAL_METRICS: { metric: MealTargetMetric; label: string }[] = [
  { metric: 'calories', label: 'Calories' }, { metric: 'protein', label: 'Protein (g)' },
  { metric: 'fat_pct', label: 'Fat %' }, { metric: 'sugar_pct', label: 'Sugar %' }, { metric: 'carb_protein_ratio', label: 'Carb:protein' },
]
const MODES: TargetMode[] = ['off', 'min', 'max', 'range']
type Row = { mode: TargetMode; min: string; max: string }
const EMPTY: Row = { mode: 'off', min: '', max: '' }
const isPct = (m: string) => m === 'fat_pct' || m === 'sugar_pct'

function seed(t: { mode: TargetMode; target_min: number | null; target_max: number | null } | undefined, density: boolean, unit: 'oz' | 'g'): Row {
  if (!t) return EMPTY
  const f = (n: number | null) => n == null ? '' : String(density ? Number(kcalPerGramToInput(n, unit).toFixed(2)) : n)
  return { mode: t.mode, min: f(t.target_min), max: f(t.target_max) }
}
function num(s: string, density: boolean, unit: 'oz' | 'g'): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return density ? inputToKcalPerGram(n, unit) : n
}
function bounds(row: Row, density: boolean, unit: 'oz' | 'g'): { min: number | null; max: number | null } {
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
function outBounds(
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
function rowError(metric: string, row: Row, density: boolean, unit: 'oz' | 'g'): string | null {
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

export default function TargetsDialog({
  meals, dailyTargets, mealTargets, saving = false, onSave, onClose,
}: {
  // `plan` is accepted for a stable call site (FoodPlanDocument passes the whole
  // plan) but the save target id is supplied by the caller's mutation, so the
  // dialog itself does not read it.
  plan: FoodPlan; meals: Meal[]; dailyTargets: FoodPlanDailyTarget[]; mealTargets: MealTarget[]
  saving?: boolean; onSave: (payload: TargetsSavePayload) => void; onClose: () => void
}) {
  const { weightUnit } = useWeightUnit()
  // Capture a STABLE baseline ONCE at open: the rows as loaded AND the unit in
  // effect at that moment. A lazy useState initializer runs exactly once, so a
  // later unit toggle or a query refetch cannot retroactively shift the baseline
  // or the conversion factor - which would otherwise falsely mark untouched rows
  // dirty and round-trip (corrupt) canonical calorie-density values. EVERY
  // conversion and dirty check below uses `snapshot.unit`, never the live
  // weightUnit. (Editing a meal added after open still works: its baseline is an
  // absent key -> EMPTY, which is the correct "no target yet" baseline.)
  const [snapshot] = useState(() => {
    const unit = weightUnit
    const dailyBy = new Map(dailyTargets.map((t) => [t.metric, t]))
    const mealBy = new Map(mealTargets.map((t) => [`${t.meal_id}:${t.metric}`, t]))
    const daily = Object.fromEntries(DAILY_METRICS.map(({ metric }) => [metric, seed(dailyBy.get(metric), metric === 'calorie_density', unit)])) as Record<string, Row>
    const meal = Object.fromEntries(meals.flatMap((m) => MEAL_METRICS.map(({ metric }) => [`${m.id}:${metric}`, seed(mealBy.get(`${m.id}:${metric}`), false, unit)]))) as Record<string, Row>
    return { unit, dailyBy, mealBy, daily, meal }
  })
  const { unit } = snapshot
  const [daily, setDaily] = useState(snapshot.daily)
  const [meal, setMeal] = useState(snapshot.meal)
  const [openMeals, setOpenMeals] = useState<Set<string>>(new Set())
  const dirty = (a: Row, b: Row) => a.mode !== b.mode || a.min !== b.min || a.max !== b.max

  const errors = [
    ...DAILY_METRICS.map(({ metric }) => rowError(metric, daily[metric] ?? EMPTY, metric === 'calorie_density', unit)),
    ...meals.flatMap((m) => MEAL_METRICS.map(({ metric }) => rowError(metric, meal[`${m.id}:${metric}`] ?? EMPTY, false, unit))),
  ].filter(Boolean)
  const canSave = errors.length === 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const payload: TargetsSavePayload = { dailyUpserts: [], dailyDeletes: [], mealUpserts: [], mealDeletes: [] }
    for (const { metric } of DAILY_METRICS) {
      const initRow = snapshot.daily[metric] ?? EMPTY
      const row = daily[metric] ?? EMPTY
      if (!dirty(row, initRow)) continue
      if (row.mode === 'off') { if (snapshot.dailyBy.get(metric)) payload.dailyDeletes.push(metric); continue }
      const b = outBounds(row, initRow, snapshot.dailyBy.get(metric), metric === 'calorie_density', unit)
      payload.dailyUpserts.push({ metric, mode: row.mode, target_min: b.min, target_max: b.max })
    }
    for (const m of meals) for (const { metric } of MEAL_METRICS) {
      const key = `${m.id}:${metric}`
      const initRow = snapshot.meal[key] ?? EMPTY
      const row = meal[key] ?? EMPTY
      if (!dirty(row, initRow)) continue
      if (row.mode === 'off') { if (snapshot.mealBy.get(key)) payload.mealDeletes.push({ meal_id: m.id, metric }); continue }
      const b = outBounds(row, initRow, snapshot.mealBy.get(key), false, unit)
      payload.mealUpserts.push({ meal_id: m.id, metric, mode: row.mode, target_min: b.min, target_max: b.max })
    }
    onSave(payload)
  }

  const densityLabel = unit === 'oz' ? 'kcal/oz' : 'kcal/g'
  return (
    <Modal open onClose={onClose} title="Targets" className="w-[calc(100vw-2rem)] max-w-lg">
      <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-gray-900">Daily targets</legend>
          {DAILY_METRICS.map(({ metric, label }) => (
            <MetricRow key={metric} id={`daily-${metric}`} label={metric === 'calorie_density' ? `Calorie density (${densityLabel})` : label}
              row={daily[metric] ?? EMPTY} error={rowError(metric, daily[metric] ?? EMPTY, metric === 'calorie_density', unit)}
              onChange={(r) => setDaily((s) => ({ ...s, [metric]: r }))} />
          ))}
        </fieldset>
        {meals.map((m) => {
          const open = openMeals.has(m.id)
          const panelId = `meal-targets-${m.id}`
          // The toggle lives INSIDE the legend so the fieldset has an accessible
          // name (a fieldset without a legend is an a11y error). aria-controls +
          // aria-expanded tie the button to the collapsible panel.
          return (
            <fieldset key={m.id} className="space-y-1.5">
              <legend className="w-full">
                <button type="button" id={`${panelId}-toggle`} aria-expanded={open} aria-controls={panelId}
                  onClick={() => setOpenMeals((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}
                  className="flex w-full items-center gap-1 text-sm font-semibold text-gray-900">
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {m.name} targets
                </button>
              </legend>
              <div id={panelId} hidden={!open} className="space-y-1.5">
                {open && MEAL_METRICS.map(({ metric, label }) => {
                  const key = `${m.id}:${metric}`
                  return <MetricRow key={key} id={`meal-${key}`} label={label} row={meal[key] ?? EMPTY}
                    error={rowError(metric, meal[key] ?? EMPTY, false, unit)}
                    onChange={(r) => setMeal((s) => ({ ...s, [key]: r }))} />
                })}
              </div>
            </fieldset>
          )
        })}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
          <PrimaryButton type="submit" disabled={saving || !canSave}>{saving ? 'Saving...' : 'Save targets'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}

function MetricRow({ id, label, row, error, onChange }: { id: string; label: string; row: Row; error: string | null; onChange: (r: Row) => void }) {
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
