import { useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { useWeightUnit } from '../lib/use-weight-unit'
import type {
  FoodPlanDailyTarget,
  Meal,
  MealTarget,
  MealTargetMetric,
  SaveTargetsRequest,
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

const MEAL_METRICS: { metric: MealTargetMetric; label: string }[] = [
  { metric: 'calories', label: 'Calories' },
  { metric: 'protein', label: 'Protein (g)' },
  { metric: 'fat_pct', label: 'Fat %' },
  { metric: 'sugar_pct', label: 'Sugar %' },
  { metric: 'carb_protein_ratio', label: 'Carb:protein' },
]

// The plan's target editor. Submit builds the COMPLETE target set (design
// decision 1: full-replace save) - every row whose mode is not Off, with
// untouched fields resubmitting their stored canonical values (outBounds,
// I-CANONICAL). Off rows are simply omitted; the server deletes what the
// payload doesn't carry.
export default function TargetsDialog({
  meals,
  dailyTargets,
  mealTargets,
  saving = false,
  saveError,
  onSave,
  onClose,
}: {
  meals: Meal[]
  dailyTargets: FoodPlanDailyTarget[]
  mealTargets: MealTarget[]
  saving?: boolean
  saveError: string | null
  onSave: (payload: SaveTargetsRequest) => void
  onClose: () => void
}) {
  const { weightUnit } = useWeightUnit()
  // Capture a STABLE baseline ONCE at open: the rows as loaded AND the unit
  // in effect at that moment. A lazy useState initializer runs exactly once,
  // so a later unit toggle or query refetch cannot retroactively shift the
  // baseline or the conversion factor - which would otherwise round-trip
  // (corrupt) canonical calorie-density values on the full-replace save.
  // EVERY conversion and untouched-field check below uses `snapshot.unit`,
  // never the live weightUnit. (A meal added after open still works: its
  // baseline is an absent key -> EMPTY, the correct "no target yet"
  // baseline.)
  const [snapshot] = useState(() => {
    const unit = weightUnit
    const dailyBy = new Map(dailyTargets.map((t) => [t.metric, t]))
    const mealBy = new Map(mealTargets.map((t) => [`${t.mealId}:${t.metric}`, t]))
    const daily = Object.fromEntries(
      DAILY_METRICS.map(({ metric }) => [
        metric,
        seed(dailyBy.get(metric), metric === 'calorie_density', unit),
      ]),
    ) as Record<string, Row>
    const meal = Object.fromEntries(
      meals.flatMap((m) =>
        MEAL_METRICS.map(({ metric }) => [
          `${m.id}:${metric}`,
          seed(mealBy.get(`${m.id}:${metric}`), false, unit),
        ]),
      ),
    ) as Record<string, Row>
    return { unit, dailyBy, mealBy, daily, meal }
  })
  const { unit } = snapshot
  const [daily, setDaily] = useState(snapshot.daily)
  const [meal, setMeal] = useState(snapshot.meal)
  const [openMeals, setOpenMeals] = useState<Set<string>>(new Set())

  const errors = [
    ...DAILY_METRICS.map(({ metric }) =>
      rowError(metric, daily[metric] ?? EMPTY, metric === 'calorie_density', unit),
    ),
    ...meals.flatMap((m) =>
      MEAL_METRICS.map(({ metric }) =>
        rowError(metric, meal[`${m.id}:${metric}`] ?? EMPTY, false, unit),
      ),
    ),
  ].filter(Boolean)
  const canSave = errors.length === 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    const payload: SaveTargetsRequest = { daily: [], meals: [] }
    for (const { metric } of DAILY_METRICS) {
      const row = daily[metric] ?? EMPTY
      if (row.mode === 'off') continue
      const initRow = snapshot.daily[metric] ?? EMPTY
      const b = outBounds(
        row,
        initRow,
        snapshot.dailyBy.get(metric),
        metric === 'calorie_density',
        unit,
      )
      payload.daily.push({ metric, mode: row.mode, targetMin: b.min, targetMax: b.max })
    }
    for (const m of meals) {
      for (const { metric } of MEAL_METRICS) {
        const key = `${m.id}:${metric}`
        const row = meal[key] ?? EMPTY
        if (row.mode === 'off') continue
        const initRow = snapshot.meal[key] ?? EMPTY
        const b = outBounds(row, initRow, snapshot.mealBy.get(key), false, unit)
        payload.meals.push({
          mealId: m.id,
          metric,
          mode: row.mode,
          targetMin: b.min,
          targetMax: b.max,
        })
      }
    }
    onSave(payload)
  }

  const densityLabel = unit === 'oz' ? 'kcal/oz' : 'kcal/g'
  return (
    <Modal
      open
      onClose={onClose}
      title="Targets"
      className="w-[calc(100vw-2rem)] max-w-lg"
      closeOnBackdropClick={false}
    >
      <form onSubmit={submit} className="max-h-[70vh] space-y-4 overflow-y-auto p-6" noValidate>
        <h2 className="text-base font-semibold text-gray-900">Targets</h2>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-semibold text-gray-900">Daily targets</legend>
          {DAILY_METRICS.map(({ metric, label }) => (
            <MetricRow
              key={metric}
              id={`daily-${metric}`}
              label={metric === 'calorie_density' ? `Calorie density (${densityLabel})` : label}
              row={daily[metric] ?? EMPTY}
              error={rowError(metric, daily[metric] ?? EMPTY, metric === 'calorie_density', unit)}
              onChange={(r) => setDaily((s) => ({ ...s, [metric]: r }))}
            />
          ))}
        </fieldset>
        {meals.map((m) => {
          const open = openMeals.has(m.id)
          const panelId = `meal-targets-${m.id}`
          // The toggle lives INSIDE the legend so the fieldset has an
          // accessible name (a fieldset without a legend is an a11y error).
          // aria-controls + aria-expanded tie the button to the panel.
          return (
            <fieldset key={m.id} className="space-y-1.5">
              <legend className="w-full">
                <button
                  type="button"
                  id={`${panelId}-toggle`}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpenMeals((s) => {
                      const n = new Set(s)
                      if (n.has(m.id)) n.delete(m.id)
                      else n.add(m.id)
                      return n
                    })
                  }
                  className="flex w-full items-center gap-1 text-sm font-semibold text-gray-900"
                >
                  {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />} {m.name} targets
                </button>
              </legend>
              <div id={panelId} hidden={!open} className="space-y-1.5">
                {open &&
                  MEAL_METRICS.map(({ metric, label }) => {
                    const key = `${m.id}:${metric}`
                    return (
                      <MetricRow
                        key={key}
                        id={`meal-${key}`}
                        label={label}
                        row={meal[key] ?? EMPTY}
                        error={rowError(metric, meal[key] ?? EMPTY, false, unit)}
                        onChange={(r) => setMeal((s) => ({ ...s, [key]: r }))}
                      />
                    )
                  })}
              </div>
            </fieldset>
          )
        })}
        {saveError && <p className="text-sm text-red-600">{saveError}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={saving || !canSave}>
            {saving ? 'Saving…' : 'Save targets'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
