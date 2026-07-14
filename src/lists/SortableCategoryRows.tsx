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
// Per-category SortableContext: items reorder within their own category only.
// Registering the item ids here is what makes each row's useSortable resolve
// against the right items list, so the strategy's auto-shift works.
export const sortableRows: RenderRows = (items, rowPropsFor) => (
  <SortableContext
    items={items.map((i) => makeDnDId('item', i.id))}
    strategy={verticalListSortingStrategy}
  >
    {items.map((item) => (
      <SortableItemRow key={item.id} {...rowPropsFor(item)} />
    ))}
  </SortableContext>
)
