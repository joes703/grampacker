import { useState } from 'react'
import { Search, Plus, Check } from 'lucide-react'
import type { GearItem, Category } from '../lib/types'

type Props = {
  gearItems: GearItem[]
  categories: Category[]
  listItemGearIds: Set<string>
  onAdd: (item: GearItem) => void
}

export default function LibraryPanel({ gearItems, categories, listItemGearIds, onAdd }: Props) {
  const [search, setSearch] = useState('')

  const catMap = new Map(categories.map((c) => [c.id, c.name]))

  const filtered = search.trim()
    ? gearItems.filter(
        (g) =>
          g.name.toLowerCase().includes(search.toLowerCase()) ||
          (g.description?.toLowerCase().includes(search.toLowerCase()) ?? false),
      )
    : gearItems

  return (
    <div className="flex h-full flex-col">
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
      <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
        {filtered.length === 0 ? (
          <p className="p-4 text-center text-xs text-gray-400 italic">No items found</p>
        ) : (
          filtered.map((item) => {
            const inList = listItemGearIds.has(item.id)
            const catName = item.category_id ? catMap.get(item.category_id) : null
            return (
              <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-800">{item.name}</p>
                  {catName && <p className="text-xs text-gray-400">{catName}</p>}
                </div>
                <span className="shrink-0 text-xs text-gray-500 tabular-nums">{item.weight_grams}g</span>
                <button
                  onClick={() => !inList && onAdd(item)}
                  title={inList ? 'Already in list' : 'Add to list'}
                  className={`shrink-0 rounded p-1 ${inList ? 'text-green-500 cursor-default' : 'text-gray-400 hover:text-blue-600'}`}
                >
                  {inList ? <Check size={14} /> : <Plus size={14} />}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
