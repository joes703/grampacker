import { useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useWeightUnit } from '../lib/use-weight-unit'
import type {
  FoodPlan, Meal, FoodPlanDailyTarget, MealTarget, MealTargetMetric,
} from '../lib/types'
import type { TargetsSavePayload } from '../lib/queries/food-plan'
import {
  DAILY_METRICS, EMPTY, MetricRow, seed, outBounds, rowError, type Row,
} from './daily-target-fields'

const MEAL_METRICS: { metric: MealTargetMetric; label: string }[] = [
  { metric: 'calories', label: 'Calories' }, { metric: 'protein', label: 'Protein (g)' },
  { metric: 'fat_pct', label: 'Fat %' }, { metric: 'sugar_pct', label: 'Sugar %' }, { metric: 'carb_protein_ratio', label: 'Carb:protein' },
]

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
