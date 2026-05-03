import { useEffect, useRef, useState } from 'react'
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
  // Increment from a parent to programmatically focus the search input.
  // Used by the empty-list onboarding affordance on /lists/:id at lg+.
  // The skipInitialFocus ref guards the mount-time effect run so that
  // navigating between lists (each list-detail is a fresh ListDetailInner
  // instance, so a fresh LibraryPanel) doesn't auto-focus the search.
  focusSearchTrigger?: number
}

export default function LibraryPanel({ gearItems, categories, listItemGearIds, weightUnit, onAdd, onRemove, focusSearchTrigger }: Props) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const skipInitialFocus = useRef(true)
  useEffect(() => {
    if (skipInitialFocus.current) {
      skipInitialFocus.current = false
      return
    }
    searchInputRef.current?.focus()
  }, [focusSearchTrigger])

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

  const uncategorized = filtered.filter((g) => g.category_id === null)

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={searchInputRef}
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
        {groups.length === 0 && uncategorized.length === 0 ? (
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
                regionId={`library-cat-${category.id}`}
              />
            ))}
            {uncategorized.length > 0 && (
              <CategoryGroup
                name="Uncategorized"
                items={uncategorized}
                collapsed={collapsed.has('__uncategorized__')}
                onToggle={() => toggleCollapse('__uncategorized__')}
                listItemGearIds={listItemGearIds}
                weightUnit={weightUnit}
                onAdd={onAdd}
                onRemove={onRemove}
                regionId="library-cat-uncategorized"
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
  regionId,
}: {
  name: string
  items: GearItem[]
  collapsed: boolean
  onToggle: () => void
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  regionId: string
}) {
  return (
    <div>
      {/* Category header */}
      <button
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={regionId}
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
        <div id={regionId}>
          {items.map((item) => {
            const inList = listItemGearIds.has(item.id)
            return (
              <div key={item.id} className="border-b border-gray-100">
                <button
                  type="button"
                  onClick={() => (inList ? onRemove(item) : onAdd(item))}
                  title={inList ? 'Click to remove from list' : 'Click to add to list'}
                  aria-label={inList ? `Remove ${item.name} from list` : `Add ${item.name} to list`}
                  // Hover/focus background is uniform across in-list and
                  // available rows; the in-list signal is carried entirely
                  // by the dimmed name and weight text below. An earlier
                  // pass added a soft-blue rest tint to in-list rows, but
                  // toggling that bg class on click triggered a Chrome
                  // compositor paint deferral (data flow correct, DOM
                  // correct, but the parent rounded-xl + overflow-hidden
                  // ancestor chain on the sidebar aside didn't invalidate
                  // its layer until another event repainted). Dropping
                  // the tint avoids the bug without browser-specific
                  // paint hints; dimming alone is sufficient visual cue.
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
