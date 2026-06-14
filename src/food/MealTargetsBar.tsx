import type { ReactNode } from 'react'
import type { FoodItem, FoodPlanEntry, MealTarget, MealTargetMetric } from '../lib/types'
import {
  nutrientTotals, fatPct, sugarPct, carbProteinRatio, sodiumDensity, derivedValue,
  type DerivedValue, type NutrientTotal,
} from '../lib/food/nutrition'
import { resolveMealTargets } from '../lib/food/targets'
import { formatPct, formatRatio, formatSodiumDensity } from './nutrition-format'
import NutrientTotalCell, { IncompleteMarker } from './NutrientTotalCell'
import TargetStatusMark from './TargetStatusMark'

function DerivedCell({ dv, fmt, nameForId, reason }: {
  dv: DerivedValue; fmt: (n: number) => string; nameForId: (id: string) => string; reason: string
}) {
  if (dv.state === 'incomplete') return <IncompleteMarker missingFoodIds={dv.missingFoodIds} nameForId={nameForId} reason={reason} />
  if (dv.state === 'undefined') return <span className="text-gray-400">-</span>
  return <>{fmt(dv.value)}</>
}

const formatPctFmt = (n: number) => formatPct(n)
const formatRatioFmt = (n: number) => formatRatio(n)
const formatNaFmt = (n: number) => formatSodiumDensity(n)

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return <span className="whitespace-nowrap"><span className="text-gray-400">{label} </span>{children}</span>
}

export default function MealTargetsBar({ entries, foodById, mealTargets }: {
  entries: FoodPlanEntry[]; foodById: Map<string, FoodItem>; mealTargets: MealTarget[]
}) {
  const totals = nutrientTotals(entries, foodById)
  const resolved = resolveMealTargets(mealTargets, totals)
  const nameForId = (id: string) => foodById.get(id)?.name ?? 'Unknown food'
  const mark = (m: MealTargetMetric) => { const rt = resolved.get(m); return rt ? <TargetStatusMark status={rt.status} /> : null }
  const num = (t: NutrientTotal, kind: 'calories' | 'grams') => <NutrientTotalCell total={t} kind={kind} nameForId={nameForId} />

  const fat = derivedValue([totals.fat_grams, totals.carbs_grams, totals.protein_grams], () => fatPct(totals.fat_grams, totals.carbs_grams, totals.protein_grams))
  const sugar = derivedValue([totals.sugar_grams, totals.fat_grams, totals.carbs_grams, totals.protein_grams], () => sugarPct(totals.sugar_grams, totals.fat_grams, totals.carbs_grams, totals.protein_grams))
  const ratio = derivedValue([totals.carbs_grams, totals.protein_grams], () => carbProteinRatio(totals.carbs_grams, totals.protein_grams))
  const naD = derivedValue([totals.sodium_mg, totals.calories], () => sodiumDensity(totals.sodium_mg, totals.calories))

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 pb-1 text-xs text-gray-500">
      <Stat label="Cal">{num(totals.calories, 'calories')}{mark('calories')}</Stat>
      <Stat label="Protein">{num(totals.protein_grams, 'grams')}{mark('protein')}</Stat>
      <Stat label="Fat%"><DerivedCell dv={fat} fmt={formatPctFmt} nameForId={nameForId} reason="missing fat, carbs, or protein" />{mark('fat_pct')}</Stat>
      <Stat label="Sugar%"><DerivedCell dv={sugar} fmt={formatPctFmt} nameForId={nameForId} reason="missing sugar, fat, carbs, or protein" />{mark('sugar_pct')}</Stat>
      <Stat label="Carb:Pro"><DerivedCell dv={ratio} fmt={formatRatioFmt} nameForId={nameForId} reason="missing carbs or protein" />{mark('carb_protein_ratio')}</Stat>
      <Stat label="Na density"><DerivedCell dv={naD} fmt={formatNaFmt} nameForId={nameForId} reason="missing sodium or calories" /></Stat>
    </div>
  )
}
