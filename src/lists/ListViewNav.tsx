import { Link } from 'react-router'
import type { ListDetailMode } from './list-detail-mode'
import { persistedListPath } from './list-detail-mode'

const VIEWS: { mode: ListDetailMode; label: string }[] = [
  // Keep in step with LIST_VIEW_LABELS in list-detail-mode.ts, which feeds the
  // document title from the same strings.
  { mode: 'edit', label: 'Category' },
  { mode: 'food', label: 'Food' },
  { mode: 'pack', label: 'Pack' },
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
          <Link
            key={view.mode}
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
        )
      })}
    </nav>
  )
}
