import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSharedList, fetchSharedListItems, fetchSharedListCategories } from '../lib/queries'
import type { Category, ListItemWithGear } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import WeightTable from './WeightTable'
import PanelCard from './PanelCard'
import CategoryGroup from './CategoryGroup'

export default function SharePage() {
  const { token } = useParams<{ token: string }>()
  const { weightUnit, toggleWeightUnit } = useWeightUnit()

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

  // Fetch only the categories actually referenced by this list's items.
  const categoryIds = [...new Set(
    items.map((i) => i.gear_item?.category_id ?? null).filter((c): c is string => c !== null),
  )]

  const { data: categories = [] } = useQuery({
    queryKey: ['shared-list-categories', list?.id, categoryIds.join(',')],
    queryFn: () => fetchSharedListCategories(categoryIds),
    enabled: Boolean(list?.id) && categoryIds.length > 0,
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

  // Group items by category, ordered by category.sort_order; uncategorised last.
  const catMap = new Map(categories.map((c) => [c.id, c]))
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)

  type Group = { category: Category | null; items: ListItemWithGear[] }
  const grouped: Group[] = sortedCats
    .map((cat) => ({
      category: cat,
      items: items.filter((i) => i.gear_item?.category_id === cat.id),
    }))
    .filter((g) => g.items.length > 0)

  const uncategorisedItems = items.filter(
    (i) => !i.gear_item || i.gear_item.category_id === null || !catMap.has(i.gear_item.category_id),
  )
  if (uncategorisedItems.length > 0) grouped.push({ category: null, items: uncategorisedItems })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-gray-900">{list.name}</h1>
          <button
            onClick={toggleWeightUnit}
            title={`Switch to ${weightUnit === 'g' ? 'oz' : 'g'}`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            {weightUnit}
          </button>
        </div>

        {/* Notes + Weight summary — side by side, equal halves (read-only) */}
        <div className={`mb-6 grid gap-4 ${items.length > 0 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          <PanelCard title="Notes">
            {list.description ? (
              <p className="px-3 py-2 text-sm text-gray-700 whitespace-pre-line min-h-[8rem]">
                {list.description}
              </p>
            ) : (
              <p className="px-3 py-2 text-sm text-gray-400 italic min-h-[8rem]">No notes</p>
            )}
          </PanelCard>
          {items.length > 0 && (
            <PanelCard title="Weight summary">
              <WeightTable items={items} categories={categories} />
            </PanelCard>
          )}
        </div>

        {/* Items grouped by category */}
        <div className="space-y-4">
          {grouped.map((group) => (
            <CategoryGroup
              key={group.category?.id ?? '__uncategorised__'}
              name={group.category?.name ?? 'Uncategorised'}
              items={group.items}
              weightUnit={weightUnit}
              collapsible={false}
            />
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-gray-400">
          Made with grampacker
        </p>
      </div>
    </div>
  )
}

