import type { Category, List, ListItemWithGear } from '../lib/types'
import WeightTable from './WeightTable'

type Props = {
  list: List
  listItems: ListItemWithGear[]
  categories: Category[]
}

// Print-only header. NavBar (list name) and the Notes/WeightTable panels
// are hidden in print and pack mode hides them on screen too, so the
// printed sheet needs its own list-name + notes + compact weight summary
// block. `hidden print:block` keeps it out of the screen DOM entirely.
// WeightTable already no-ops on empty lists.
export default function PrintListHeader({ list, listItems, categories }: Props) {
  return (
    <div className="hidden print:block">
      <h1 className="text-2xl font-bold text-gray-900">{list.name}</h1>
      {list.description && (
        <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{list.description}</p>
      )}
      {listItems.length > 0 && (
        <div className="mt-3 mb-4">
          <WeightTable items={listItems} categories={categories} />
        </div>
      )}
    </div>
  )
}
