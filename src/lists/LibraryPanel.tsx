import { useState } from 'react'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import type { GearItem, Category } from '../lib/types'
import { formatItemWeight, type WeightUnit } from '../lib/weight'

type Props = {
  gearItems: GearItem[]
  categories: Category[]
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
}

export default function LibraryPanel({ gearItems, categories, listItemGearIds, weightUnit, onAdd }: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(new Set<string>())

  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
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
          <p className="p-4 text-center text-xs text-gray-400 italic">
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
}: {
  name: string
  items: GearItem[]
  collapsed: boolean
  onToggle: () => void
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
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
        <span className="flex-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {name}
        </span>
        <span className="text-xs text-gray-400">{items.length}</span>
      </button>

      {/* Items */}
      {!collapsed && (
        <div className="divide-y divide-gray-50">
          {items.map((item) => {
            const inList = listItemGearIds.has(item.id)
            return (
              <div key={item.id} className="flex items-center gap-2 px-3 py-0.5 hover:bg-gray-50">
                <p className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{item.name}</p>
                <span className="shrink-0 text-xs text-gray-500 tabular-nums">
                  {formatItemWeight(item.weight_grams, weightUnit)}
                </span>
                <button
                  onClick={() => !inList && onAdd(item)}
                  title={inList ? 'Already in list' : 'Add to list'}
                  className={`shrink-0 rounded p-0.5 ${
                    inList
                      ? 'text-green-400 cursor-default'
                      : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                  }`}
                >
                  <Plus size={15} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
