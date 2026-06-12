import type { FoodItem, FoodPlanEntry } from '../lib/types'
import { FLAT_TABLE_ROW } from '../components/flat-table-styles'

const BASIS_LABEL: Record<FoodPlanEntry['basis'], string> = { servings: 'servings', packages: 'pkg', weight: 'g' }

function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
}

export default function FoodPlanEntryRow({
  entry, food, actions,
}: {
  entry: FoodPlanEntry
  food: FoodItem | undefined
  actions?: React.ReactNode
}) {
  return (
    <div className={`${FLAT_TABLE_ROW} flex items-center justify-between gap-3`}>
      <span className="min-w-0 truncate text-sm text-gray-900">{food?.name ?? 'Unknown food'}</span>
      <span className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-500">
        {formatAmount(entry.amount)} {BASIS_LABEL[entry.basis]}
        {actions}
      </span>
    </div>
  )
}
