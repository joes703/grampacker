import { Link } from 'react-router'
import type { ListDetailMode } from './list-detail-mode'
import { persistedListPath } from './list-detail-mode'

// Order encodes a distinction, and it is not cosmetic. List and Pack are
// two ARRANGEMENTS of the same rows - the same gear, grouped by category or
// grouped into bags - so they belong adjacent. Food is a different document
// with its own model (days, meals, slots); it cannot be expressed as a
// grouping of gear, which is exactly why it stayed a peer page rather than
// becoming a third arrangement.
//
// The first view is called List, not Category: it is the list itself, and
// Pack and Food are sections of it. It cannot be Gear, which the top nav
// already uses for the gear library.
//
// Keep in step with LIST_VIEW_LABELS in list-detail-mode.ts, which feeds the
// document title from the same strings.
const VIEWS: { mode: ListDetailMode; label: string }[] = [
  { mode: 'edit', label: 'List' },
  { mode: 'pack', label: 'Pack' },
  { mode: 'food', label: 'Food' },
]

// These are peer URL destinations, not on/off toggles. Links keep
// every view one activation away, preserve browser navigation, and expose the
// selected destination with aria-current instead of claiming binary state.
//
// Drawn as underline tabs, not a segmented control: the g/oz picker in the
// toolbar is a segmented control, and a view switch must not look like a
// setting. The gray rule under the row belongs to the toolbar.
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
      className="flex w-full items-stretch gap-4 lg:gap-6 lg:px-1"
    >
      {VIEWS.map((view) => {
        const active = mode === view.mode
        return (
          <Link
            key={view.mode}
            to={persistedListPath(listId, view.mode)}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-11 flex-1 items-center justify-center border-b-2 px-1 text-sm font-medium transition-colors lg:min-h-8 lg:flex-none ${
              active
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {view.label}
          </Link>
        )
      })}
    </nav>
  )
}
