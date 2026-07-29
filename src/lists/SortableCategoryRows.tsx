import { Fragment } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { makeDnDId } from '../lib/dnd-ids'
import SortableItemRow from './SortableItemRow'
import { PlacementBanner, PlacementSlot } from './placement-context'
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
// Pack rows additionally carry click-to-place insertion slots between them:
// the non-drag pointer path WCAG 2.5.7 wants for reorder. Only pack rows -
// category grouping (and Pack's own no-location fallback, which uses it) has
// no row menu to start placement from, so slots there would be unreachable.
//
// The slots are ALWAYS rendered, never `{placing && ...}`. This function runs
// during CategoryGroup's render, so a conditional would be evaluated once and
// frozen by the memo; each slot mounts, subscribes to the placement context,
// and returns null while the mode is closed.
function makeSortableRows(dndKind: 'item' | 'packing-item'): RenderRows {
  const placeable = dndKind === 'packing-item'
  return (items, rowPropsFor, section) => (
    <SortableContext
      items={items.map((i) => makeDnDId(dndKind, i.id))}
      strategy={verticalListSortingStrategy}
    >
      {/* Names what is moving and carries the Cancel. Escape alone would leave
          touch users with no way out of a mode built for them. */}
      {placeable && <PlacementBanner items={items} section={section} />}
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {placeable && (
            <PlacementSlot slot={index} items={items} section={section} />
          )}
          <SortableItemRow dndKind={dndKind} {...rowPropsFor(item)} />
        </Fragment>
      ))}
      {/* n rows means n+1 slots; this is the one below the last row. */}
      {placeable && (
        <PlacementSlot slot={items.length} items={items} section={section} />
      )}
    </SortableContext>
  )
}

export const sortableRows = makeSortableRows('item')
export const packingSortableRows = makeSortableRows('packing-item')
