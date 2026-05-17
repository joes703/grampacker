import { useMemo } from 'react'
import type { Category } from '../lib/types'

// Sentinel value for the synthetic "Uncategorized" bucket. Matches the
// literal used elsewhere in the codebase (groupByCategory output, weight
// breakdown rows) so callers can pass the same string through without
// translation.
export const UNCATEGORIZED_CHIP_VALUE = '__uncategorized__'

// `null` selection = the "All" chip (no category filter). A real category
// id filters to that category. UNCATEGORIZED_CHIP_VALUE filters to items
// with category_id === null.
export type CategoryChipValue = string | null

type ChipItem = { category_id: string | null }

type Props = {
  /** Categories in display order (caller pre-sorts by sort_order). */
  categories: Category[]
  /** Items the chip rail derives presence from — pass the SEARCH-FILTERED
   *  set so the rail naturally narrows as search narrows. */
  items: ChipItem[]
  selected: CategoryChipValue
  onChange: (next: CategoryChipValue) => void
}

// Horizontal-scroll pill rail used above gear lists to filter by category
// without dropping the existing search input. Selecting a chip narrows
// what the page renders; "All" clears the filter.
//
// Visibility rule: only show chips that have at least one item under the
// current search, EXCEPT for the currently-selected chip — that one stays
// visible even when its matches go to zero so the user can see and clear
// the active filter (otherwise it would silently vanish from the rail
// while still gating the list). Showing disabled chips for empty
// categories was rejected: it clutters the rail and reads as "tap me,
// nothing happens." Hiding is the simpler and cleaner default.
//
// Accessibility:
//   - Each chip is a real <button> with aria-pressed for the selected one.
//   - The scrollable container is overflow-x-auto without overflow-y, so
//     focus outlines aren't clipped vertically when a chip is focused.
//   - whitespace-nowrap on chips prevents wrapping inside the rail.
export default function CategoryFilterChips({ categories, items, selected, onChange }: Props) {
  // Derive which buckets have at least one item under the current search.
  const presentCategoryIds = useMemo(() => {
    const ids = new Set<string>()
    let hasUncategorized = false
    for (const item of items) {
      if (item.category_id === null) hasUncategorized = true
      else ids.add(item.category_id)
    }
    return { ids, hasUncategorized }
  }, [items])

  const visibleCategories = useMemo(
    () =>
      categories.filter(
        (c) => presentCategoryIds.ids.has(c.id) || selected === c.id,
      ),
    [categories, presentCategoryIds.ids, selected],
  )

  const showUncategorizedChip =
    presentCategoryIds.hasUncategorized || selected === UNCATEGORIZED_CHIP_VALUE

  // Hide the rail entirely when there's nothing but "All" — no point
  // showing a single chip that does nothing.
  if (visibleCategories.length === 0 && !showUncategorizedChip) return null

  return (
    <div
      role="group"
      aria-label="Filter by category"
      className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
    >
      <Chip
        label="All"
        active={selected === null}
        onClick={() => onChange(null)}
      />
      {visibleCategories.map((c) => (
        <Chip
          key={c.id}
          label={c.name}
          active={selected === c.id}
          onClick={() => onChange(c.id)}
        />
      ))}
      {showUncategorizedChip && (
        <Chip
          label="Uncategorized"
          active={selected === UNCATEGORIZED_CHIP_VALUE}
          onClick={() => onChange(UNCATEGORIZED_CHIP_VALUE)}
        />
      )}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
        active
          ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'border-gray-300 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  )
}
