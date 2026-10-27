import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { makeDnDId } from '../lib/dnd-ids'
import SortableItemRow from './SortableItemRow'
import SortableFoodRow from './SortableFoodRow'
import { packRowId, unionPackRows, type PackRow } from './pack-rows'
import type { RenderRows } from './section-parts'

// The drag half of a section's rows, kept OUT of CategoryTable and
// PackSection so that CategoryTable - which the public read-only share view
// renders - has no import edge to @dnd-kit at all. A `sortable` boolean
// cannot hide an import from the bundler; a prop can. So the authenticated
// list view passes these in as `renderRows`, and the share view passes
// nothing and gets plain rows. Only ListDetailPage imports this module, so
// @dnd-kit lands in the authenticated chunk and nowhere else.
//
// Three id namespaces, one component:
//
//   sortableRows        - `item:` ids. Category grouping. Rows reorder within
//                         their own category and nowhere else.
//   packingSortableRows - `packing-item:` ids for gear plus
//                         `packing-food-item:` ids for food (0022: a bag's
//                         contents are the UNION of both). Rows reorder within
//                         their location AND drop onto other locations, so
//                         they share an id space with the `packing-location:`
//                         targets the sections register.
//
// The kind has to reach BOTH the SortableContext registration and each row's
// useSortable, or dnd-kit resolves a row against a context it is not in and
// the strategy's auto-shift silently stops working.
//
function makeSortableRows(dndKind: 'item' | 'packing-item'): RenderRows {
  return (items, rowPropsFor, packFood) => {
    // Union display order (rank, gear-before-food, id). Without food this
    // reduces to the gear rows in the order the caller sorted them, because
    // unionPackRows is only consulted when the bundle is present.
    const rows: PackRow[] = packFood
      ? unionPackRows(items, packFood.rows)
      : items.map((item) => ({ kind: 'gear', gear: item }))
    return (
      <SortableContext
        items={rows.map((row) =>
          makeDnDId(
            row.kind === 'gear' ? dndKind : 'packing-food-item',
            packRowId(row),
          ),
        )}
        strategy={verticalListSortingStrategy}
      >
        {rows.map((row) =>
          row.kind === 'gear' ? (
            <SortableItemRow key={packRowId(row)} dndKind={dndKind} {...rowPropsFor(row.gear)} />
          ) : (
            // packFood is present by construction: a food row only exists in
            // `rows` when the caller passed the bundle.
            <SortableFoodRow key={packRowId(row)} {...packFood!.rowPropsFor(row.food)} />
          ),
        )}
      </SortableContext>
    )
  }
}

export const sortableRows = makeSortableRows('item')
export const packingSortableRows = makeSortableRows('packing-item')
