import { Fragment } from 'react'
import { Link } from 'react-router'
import type { ListDetailMode } from './list-detail-mode'
import { persistedListPath } from './list-detail-mode'

// Order encodes a distinction, and it is not cosmetic. Category and Pack are
// two ARRANGEMENTS of the same rows - the same gear, grouped by category or
// grouped into bags - so they belong adjacent. Food is a different document
// with its own model (days, meals, slots); it cannot be expressed as a
// grouping of gear, which is exactly why it stayed a peer page rather than
// becoming a third arrangement.
//
// `separatorBefore` marks where that boundary falls. Keep in step with
// LIST_VIEW_LABELS in list-detail-mode.ts, which feeds the document title
// from the same strings.
const VIEWS: { mode: ListDetailMode; label: string; separatorBefore?: true }[] = [
  { mode: 'edit', label: 'Category' },
  { mode: 'pack', label: 'Pack' },
  { mode: 'food', label: 'Food', separatorBefore: true },
]

// These are peer URL destinations, not on/off toggles. Links keep
// every view one activation away, preserve browser navigation, and expose the
// selected destination with aria-current instead of claiming binary state.
export default function ListViewNav({
  listId,
  mode,
}: {
  listId: string
  mode: ListDetailMode
}) {
  return (
    <nav
      aria-label="List views"
      className="inline-flex w-full items-stretch rounded-lg border border-gray-300 bg-gray-50 p-0.5 lg:w-auto"
    >
      {VIEWS.map((view) => {
        const active = mode === view.mode
        return (
          <Fragment key={view.mode}>
            {view.separatorBefore && (
              // Decoration for a distinction the order already carries, so it
              // is hidden from assistive tech: announcing a fourth element in
              // a three-destination control would cost more than the grouping
              // conveys. mx-1 keeps the segments' own padding intact.
              <span
                aria-hidden="true"
                data-testid="list-view-nav-separator"
                className="mx-1 my-1 w-px shrink-0 self-stretch bg-gray-300"
              />
            )}
            <Link
              to={persistedListPath(listId, view.mode)}
              aria-current={active ? 'page' : undefined}
              className={`inline-flex min-h-10 flex-1 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors lg:min-h-7 lg:flex-none ${
                active
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-600 hover:bg-white hover:text-gray-900'
              }`}
            >
              {view.label}
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}
