import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { makeDnDId } from '../lib/dnd-ids'
import SortableItemRow from './SortableItemRow'
import type { RenderRows } from './CategoryGroup'

// The drag half of a category's rows, kept OUT of CategoryGroup so that
// CategoryGroup - which the public read-only share view renders - has no import
// edge to @dnd-kit at all. CategoryGroup used to import SortableContext directly
// and branch on a `sortable` boolean; a boolean cannot hide an import from the
// bundler, so the share view downloaded the drag machinery it can never use.
//
// So the drag behavior is INJECTED instead: the authenticated list view passes
// this in as CategoryGroup's `renderRows`, and the share view passes nothing and
// gets plain rows. The seam is a prop, which the bundler CAN see through: only
// ListDetailPage imports this module, so @dnd-kit lands in the authenticated
// chunk and nowhere else.
//
// Two id namespaces, one component:
//
//   sortableRows        - `item:` ids. Category grouping. Rows reorder within
//                         their own category and nowhere else.
//   packingSortableRows - `packing-item:` ids. Location grouping in pack mode.
//                         Rows reorder within their location AND drop onto
//                         other locations, so they share an id space with the
//                         `packing-location:` targets the sections register.
//
// The kind has to reach BOTH the SortableContext registration and each row's
// useSortable, or dnd-kit resolves a row against a context it is not in and
// the strategy's auto-shift silently stops working.
function makeSortableRows(dndKind: 'item' | 'packing-item'): RenderRows {
  return (items, rowPropsFor) => (
    <SortableContext
      items={items.map((i) => makeDnDId(dndKind, i.id))}
      strategy={verticalListSortingStrategy}
    >
      {items.map((item) => (
        <SortableItemRow key={item.id} dndKind={dndKind} {...rowPropsFor(item)} />
      ))}
    </SortableContext>
  )
}

export const sortableRows = makeSortableRows('item')
export const packingSortableRows = makeSortableRows('packing-item')
