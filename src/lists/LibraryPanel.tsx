import { useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { GearItem, Category } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

type Props = {
  gearItems: GearItem[]
  categories: Category[]
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
}

export default function LibraryPanel({ gearItems, categories, listItemGearIds, weightUnit, onAdd, onRemove }: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(new Set<string>())

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const q = search.trim().toLowerCase()
  const filtered = q
    ? gearItems.filter(
        (g) =>
          g.name.toLowerCase().includes(q) ||
          (g.description?.toLowerCase().includes(q) ?? false),
      )
    : gearItems

  // Build groups ordered by category sort_order
  const sortedCats = [...categories].sort((a, b) => a.sort_order - b.sort_order)
  const groups = sortedCats
    .map((cat) => ({ category: cat, items: filtered.filter((g) => g.category_id === cat.id) }))
    .filter((g) => g.items.length > 0)

  const uncategorised = filtered.filter((g) => g.category_id === null)

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search gear…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Category groups */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {groups.length === 0 && uncategorised.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-400 italic">
            {q ? 'No items found' : 'No gear items yet'}
          </p>
        ) : (
          <>
            {groups.map(({ category, items }) => (
              <CategoryGroup
                key={category.id}
                name={category.name}
                items={items}
                collapsed={collapsed.has(category.id)}
                onToggle={() => toggleCollapse(category.id)}
                listItemGearIds={listItemGearIds}
                weightUnit={weightUnit}
                onAdd={onAdd}
                onRemove={onRemove}
              />
            ))}
            {uncategorised.length > 0 && (
              <CategoryGroup
                name="Uncategorised"
                items={uncategorised}
                collapsed={collapsed.has('__uncategorised__')}
                onToggle={() => toggleCollapse('__uncategorised__')}
                listItemGearIds={listItemGearIds}
                weightUnit={weightUnit}
                onAdd={onAdd}
                onRemove={onRemove}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function CategoryGroup({
  name,
  items,
  collapsed,
  onToggle,
  listItemGearIds,
  weightUnit,
  onAdd,
  onRemove,
}: {
  name: string
  items: GearItem[]
  collapsed: boolean
  onToggle: () => void
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
}) {
  return (
    <div>
      {/* Category header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-0.5 bg-gray-50 hover:bg-gray-100 text-left border-b border-gray-100"
      >
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 text-gray-400" />
        ) : (
          <ChevronDown size={13} className="shrink-0 text-gray-400" />
        )}
        <span className="flex-1 text-sm font-medium text-gray-700">
          {name}
        </span>
        <span className="text-xs tabular-nums text-gray-400">{items.length}</span>
      </button>

      {/* Items — pure picker rows. Click toggles add/remove on the active list. */}
      {!collapsed && (
        <div>
          {items.map((item) => {
            const inList = listItemGearIds.has(item.id)
            return (
              <div key={item.id} className="border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => (inList ? onRemove(item) : onAdd(item))}
                  title={inList ? 'Click to remove from list' : 'Click to add to list'}
                  className="flex w-full items-center gap-2 px-3 py-0.5 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-100"
                >
                  <span
                    className={`flex-1 min-w-0 truncate text-sm font-normal ${
                      inList ? 'text-gray-400' : 'text-gray-900'
                    }`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`shrink-0 text-xs tabular-nums ${
                      inList ? 'text-gray-300' : 'text-gray-500'
                    }`}
                  >
                    {formatItemWeight(item.weight_grams, weightUnit)}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
