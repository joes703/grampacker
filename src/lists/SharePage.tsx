import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSharedList, fetchSharedListItems } from '../lib/queries'
import WeightTable from './WeightTable'
import { computeWeightRollup, formatTotalWeight, formatGrams } from '../lib/weight'

export default function SharePage() {
  const { token } = useParams<{ token: string }>()

  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['shared-list', token],
    queryFn: () => fetchSharedList(token!),
    enabled: Boolean(token),
  })

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['shared-list-items', list?.id],
    queryFn: () => fetchSharedListItems(list!.id),
    enabled: Boolean(list?.id),
  })

  // Categories needed for WeightTable grouping — public RLS allows reading them
  // since categories has no public policy, we fetch with the anon key which is fine
  // for display (they're not sensitive). Actually categories are owner-only in RLS,
  // so we won't have them on a public page — pass empty array and WeightTable will
  // show "Uncategorised" for everything, which is acceptable.
  const { data: categories = [] } = useQuery({
    queryKey: ['shared-categories'],
    queryFn: async () => [],
    enabled: false,
  })

  if (listLoading || itemsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!list) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">List not found</p>
          <p className="mt-1 text-sm text-gray-400">This link may be invalid or sharing has been turned off.</p>
        </div>
      </div>
    )
  }

  const rollup = computeWeightRollup(
    items.map((i) => ({
      weight_grams: i.weight_grams,
      quantity: i.quantity,
      is_worn: i.is_worn,
      is_consumable: i.is_consumable,
    })),
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-10">
        {/* Header */}
        <div className="mb-1 flex items-baseline gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Shared
          </span>
        </div>
        {list.description && (
          <p className="mb-4 text-sm text-gray-500">{list.description}</p>
        )}

        {/* Summary stats */}
        <div className="mb-6 flex flex-wrap gap-4 rounded-xl border border-gray-200 bg-white p-4">
          <Stat label="Total" value={formatTotalWeight(rollup.totalGrams, 'g')} sub={formatTotalWeight(rollup.totalGrams, 'oz')} />
          <Stat label="Base weight" value={formatTotalWeight(rollup.baseGrams, 'g')} sub={formatTotalWeight(rollup.baseGrams, 'oz')} highlight />
          {rollup.wornGrams > 0 && (
            <Stat label="Worn" value={formatTotalWeight(rollup.wornGrams, 'g')} sub={formatTotalWeight(rollup.wornGrams, 'oz')} />
          )}
          {rollup.consumableGrams > 0 && (
            <Stat label="Consumable" value={formatTotalWeight(rollup.consumableGrams, 'g')} sub={formatTotalWeight(rollup.consumableGrams, 'oz')} />
          )}
          <Stat label="Items" value={String(items.length)} />
        </div>

        {/* Item list */}
        <div className="mb-6 space-y-1">
          {items.map((item) => {
            const name = item.gear_item?.name ?? '(deleted item)'
            const label = item.quantity > 1 ? `${name} ×${item.quantity}` : name
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-sm border border-gray-100"
              >
                <span className="flex-1 min-w-0 truncate text-gray-800">{label}</span>
                {item.is_worn && (
                  <span className="shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">Worn</span>
                )}
                {item.is_consumable && (
                  <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-xs text-orange-700">Consumable</span>
                )}
                <span className="shrink-0 tabular-nums text-gray-500">{formatGrams(item.weight_grams * item.quantity)}</span>
              </div>
            )
          })}
        </div>

        {/* Weight table */}
        <WeightTable items={items} categories={categories} />

        <p className="mt-6 text-center text-xs text-gray-400">
          Made with grampacker
        </p>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`flex flex-col ${highlight ? 'text-blue-700' : 'text-gray-700'}`}>
      <span className="text-xs text-gray-400">{label}</span>
      <span className="text-base font-semibold">{value}</span>
      {sub && <span className="text-xs text-gray-400">{sub}</span>}
    </div>
  )
}
