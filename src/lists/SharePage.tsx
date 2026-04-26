import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Shirt, UtensilsCrossed } from 'lucide-react'
import { fetchSharedList, fetchSharedListItems, fetchSharedListCategories } from '../lib/queries'
import type { Category, ListItemWithGear } from '../lib/types'
import { formatItemWeight } from '../lib/weight'
import WeightTable from './WeightTable'

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
        <div className="mb-1">
          <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
        </div>
        {list.description && (
          <p className="mb-6 text-sm text-gray-500">{list.description}</p>
        )}

        {/* Weight summary */}
        {items.length > 0 && (
          <div className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Weight summary
            </p>
            <WeightTable items={items} categories={categories} />
          </div>
        )}

        {/* Items grouped by category */}
        <div className="space-y-4">
          {grouped.map((group) => (
            <SharedCategoryGroup
              key={group.category?.id ?? '__uncategorised__'}
              name={group.category?.name ?? 'Uncategorised'}
              items={group.items}
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

function SharedCategoryGroup({ name, items }: { name: string; items: ListItemWithGear[] }) {
  const totalGrams = items.reduce((s, i) => s + i.weight_grams * i.quantity, 0)

  return (
    <div>
      {/* Category header — also the column header */}
      <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-gray-100 mb-1">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-700">{name}</span>
        <div className="shrink-0 w-7" />
        <div className="shrink-0 w-7" />
        <div className="shrink-0 w-10 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Qty
        </div>
        <div className="shrink-0 w-16 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Weight
        </div>
      </div>

      {/* Items */}
      <div className="space-y-0.5 pl-2">
        {items.map((item) => (
          <SharedItemRow key={item.id} item={item} />
        ))}
        {/* Footer total */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
          <div className="flex-1 min-w-0" />
          <div className="shrink-0 w-7" />
          <div className="shrink-0 w-7" />
          <div className="shrink-0 w-10" />
          <div className="shrink-0 w-16 text-right tabular-nums font-semibold text-gray-700">
            {formatItemWeight(totalGrams, 'g')}
          </div>
        </div>
      </div>
    </div>
  )
}

function SharedItemRow({ item }: { item: ListItemWithGear }) {
  const name = item.gear_item?.name ?? '(deleted item)'
  const description = item.gear_item?.description ?? ''

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 text-sm">
      {/* Name + description columns 1:2 */}
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="flex-1 min-w-0 truncate font-medium text-gray-900">{name}</span>
        <span className="flex-[2] min-w-0 truncate text-xs text-gray-500">{description}</span>
      </div>

      {/* Worn status (display-only) */}
      <span className="shrink-0 w-7 inline-flex items-center justify-center">
        {item.is_worn && <Shirt size={14} className="text-purple-600" aria-label="Worn" />}
      </span>

      {/* Consumable status (display-only) */}
      <span className="shrink-0 w-7 inline-flex items-center justify-center">
        {item.is_consumable && <UtensilsCrossed size={14} className="text-orange-600" aria-label="Consumable" />}
      </span>

      {/* Qty */}
      <span className="shrink-0 w-10 text-right tabular-nums text-gray-600">
        {item.quantity}
      </span>

      {/* Weight */}
      <span className="shrink-0 w-16 text-right tabular-nums text-gray-600">
        {formatItemWeight(item.weight_grams, 'g')}
      </span>
    </div>
  )
}
