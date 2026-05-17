import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import type { GearItem, Category } from '../lib/types'
import { groupByCategory } from '../lib/grouping'
import { formatItemWeight, type WeightUnit } from '../lib/weight'
import GearStatusBadge from '../gear/GearStatusBadge'
import CategoryFilterChips, {
  UNCATEGORIZED_CHIP_VALUE,
  type CategoryChipValue,
} from '../components/CategoryFilterChips'

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
  const [selectedCategory, setSelectedCategory] = useState<CategoryChipValue>(null)
  const [collapsed, setCollapsed] = useState(new Set<string>())
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Capture the focusSearchTrigger value at mount and compare on every
  // effect run. A previous "skip flag mutated inside the effect" pattern
  // broke under StrictMode's dev-only double-effect (first run mutates
  // the flag, second run falls through). Read-only ref + value compare
  // sidesteps it — both runs see initial===current and skip.
  const initialFocusSearchTrigger = useRef(focusSearchTrigger)
  useEffect(() => {
    if (focusSearchTrigger === initialFocusSearchTrigger.current) return
    searchInputRef.current?.focus()
  }, [focusSearchTrigger])

  // Stable across renders: setCollapsed from useState is referentially
  // stable, and the closure captures only that. Stability matters because
  // we pass toggleCollapse straight through as `onToggle` to the memoized
  // inner LibraryCategoryGroup — a fresh closure every render would defeat the
  // shallow-prop compare that React.memo relies on.
  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const q = search.trim().toLowerCase()
  const searchFiltered = useMemo(
    () =>
      q
        ? gearItems.filter(
            (g) =>
              g.name.toLowerCase().includes(q) ||
              (g.description?.toLowerCase().includes(q) ?? false),
          )
        : gearItems,
    [gearItems, q],
  )

  // Layer the category-chip filter on top of the search filter. The chip
  // rail derives its visible chips from searchFiltered (above) so the rail
  // narrows with search, and the chip selection then narrows further.
  const filtered = useMemo(() => {
    if (selectedCategory === null) return searchFiltered
    if (selectedCategory === UNCATEGORIZED_CHIP_VALUE) {
      return searchFiltered.filter((g) => g.category_id === null)
    }
    return searchFiltered.filter((g) => g.category_id === selectedCategory)
  }, [searchFiltered, selectedCategory])

  // Build groups ordered by category sort_order. sortedCats stays in its
  // own memo so the sort only reruns when `categories` changes — not on
  // every search keystroke (which churns `filtered`).
  const sortedCats = useMemo(
    () => [...categories].sort((a, b) => a.sort_order - b.sort_order),
    [categories],
  )

  // Empty categories filtered out (the panel hides cats with no matches
  // when the user is searching). Orphan-keyed items — a gear_item.category_id
  // pointing at a deleted category — are silently dropped, preserving the
  // previous inline behavior. In practice the gear_items.category_id ON
  // DELETE SET NULL FK makes this unreachable, but the helper documents
  // the policy explicitly. Result includes the uncategorized tail (if any
  // null-keyed items are present) appended after real-cat groups.
  const groups = useMemo(
    () =>
      groupByCategory(filtered, sortedCats, (g) => g.category_id, {
        keepEmpty: false,
        orphanPolicy: 'drop',
      }),
    [filtered, sortedCats],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Search + category chips. Chips sit immediately below the search
          input so a single eye-line covers both filters; selection composes
          with the search query rather than replacing it. */}
      <div className="p-3 border-b border-gray-200 space-y-2">
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
        <CategoryFilterChips
          categories={sortedCats}
          items={searchFiltered}
          selected={selectedCategory}
          onChange={setSelectedCategory}
        />
      </div>

      {/* Category groups */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-400 italic">
            {q ? 'No items found' : 'No gear items yet'}
          </p>
        ) : (
          <>
            {groups.map(({ category, items }) => {
              // Synthetic uncategorized row uses the '__uncategorized__'
              // sentinel for the collapsed-state key and toggleKey, and
              // 'uncategorized' as the regionId tail — matches the
              // pre-refactor literals exactly.
              const key = category?.id ?? '__uncategorized__'
              return (
                <LibraryCategoryGroup
                  key={key}
                  name={category?.name ?? 'Uncategorized'}
                  items={items}
                  collapsed={collapsed.has(key)}
                  toggleKey={key}
                  onToggle={toggleCollapse}
                  listItemGearIds={listItemGearIds}
                  weightUnit={weightUnit}
                  onAdd={onAdd}
                  onRemove={onRemove}
                  regionId={`library-cat-${category?.id ?? 'uncategorized'}`}
                />
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// Wrapped in React.memo so re-renders of LibraryPanel (driven by parent
// churn — drag ticks, NotesEditor keystrokes, list-items mutations) don't
// cascade into every gear-picker category. Memo's shallow compare works
// here because all props are reference-stable: `onToggle` is the parent's
// useCallback'd toggleCollapse, `toggleKey` is a primitive string, and
// listItemGearIds / onAdd / onRemove come from the page-level memoized
// sharedGroupProps. The earlier inline `onToggle={() => toggleCollapse(id)}`
// shape would have defeated the memo by minting a fresh closure every render.
const LibraryCategoryGroup = memo(function LibraryCategoryGroup({
  name,
  items,
  collapsed,
  toggleKey,
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
  toggleKey: string
  onToggle: (key: string) => void
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  regionId: string
}) {
  return (
    <div>
      {/* Category header - chevron is the only interactive collapse target.
          Static label area below has no hover state so the chevron is the
          obvious affordance. The header strip's bg-gray-50 stays as a
          visual section divider; it just isn't clickable as a whole. */}
      <div className="flex w-full items-center gap-1.5 px-3 py-0.5 bg-gray-50 border-b border-gray-100">
        <button
          type="button"
          onClick={() => onToggle(toggleKey)}
          aria-expanded={!collapsed}
          aria-controls={regionId}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          className="inline-flex h-10 w-10 lg:h-7 lg:w-7 items-center justify-center rounded text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0"
        >
          {collapsed ? (
            <ChevronRight size={13} />
          ) : (
            <ChevronDown size={13} />
          )}
        </button>
        <span className="flex-1 truncate text-sm font-medium text-gray-700">
          {name}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-gray-400">{items.length}</span>
      </div>

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
                  {/* Status badge — null-for-active means no leading
                      whitespace on the common case; non-active rows pick
                      up a subtle icon next to the name. */}
                  <GearStatusBadge status={item.status} compact className="shrink-0" />
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
})
