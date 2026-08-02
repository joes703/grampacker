import { Link } from 'react-router'

// Centered status block for a page whose primary query has not produced data:
// still loading, or failed outright. Lifted out of ListDetailPage (where it
// was `ListDetailStatus`) so /lists, /lists/:id and the desktop lists panel
// cannot describe the same failure three different ways.
//
// The distinction it exists to preserve: "we could not load this" is NOT
// "this does not exist". A page that renders a not-found or an empty state
// from a failed fetch tells the user their data is gone when it is only
// unreachable, and offers no way to try again.
export default function StatusPanel({
  title,
  body,
  busy = false,
  onRetry,
  showBackToLists = false,
}: {
  title: string
  body?: string
  busy?: boolean
  onRetry?: () => void
  showBackToLists?: boolean
}) {
  return (
    <div
      className="flex h-64 flex-col items-center justify-center gap-3 text-center"
      aria-busy={busy || undefined}
    >
      {/* Every state this renders arrives asynchronously, replacing a
          skeleton or a rendered page. Without a live region a screen-reader
          user gets no announcement that the load finished or failed - the
          content simply swaps under them. role="status" (polite) rather than
          alert: none of these interrupt what the user is doing. */}
      <div className="space-y-2" role="status">
        <p className="text-base font-medium text-gray-700">{title}</p>
        {body ? <p className="text-sm text-gray-500">{body}</p> : null}
      </div>
      {(onRetry || showBackToLists) ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Retry
            </button>
          ) : null}
          {showBackToLists ? (
            <Link
              to="/lists"
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to lists
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
