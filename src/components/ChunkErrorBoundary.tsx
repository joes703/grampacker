import { Component, type ErrorInfo, type ReactNode } from 'react'

// A deployment replaces the old chunks, so a tab that has been open across a
// deploy can hold an index.html whose chunk URLs no longer exist. When that tab
// finally imports one, the request for the old hash fails and the import
// rejects.
//
// Without a boundary, React unmounts the whole tree on that throw and the user
// gets a white page with no way out but a manual reload. That failure mode is
// only worth handling now because this is where the app went behind a lazy
// boundary: before, a failed chunk cost you a drawer or a markdown renderer.
// Now it would cost you the entire app.
//
// The fix for a stale document is to fetch a fresh one, so a chunk error
// reloads the page - which re-fetches index.html and with it the current chunk
// URLs. Guarded by a sessionStorage flag so a genuinely broken deploy shows a
// message instead of reloading forever.
const RELOADED_KEY = 'gp:chunk-reloaded'

// Matching on message text is unlovely, but there is no error CODE for this:
// each engine words it differently, and a chunk failure is otherwise an
// ordinary TypeError. Erring toward matching too little is the safe direction -
// a miss shows the fallback UI, which still offers the reload button.
function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i.test(
    `${error.name} ${error.message}`,
  )
}

type Props = { children: ReactNode }
type State = { failed: boolean }

export default class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (!isChunkLoadError(error)) {
      // Not ours. Re-throwing from here would be swallowed, so leave a trace
      // and show the fallback: a blank page with no explanation is worse.
      console.error('Unhandled render error', error, info.componentStack)
      return
    }

    let alreadyReloaded = false
    try {
      alreadyReloaded = sessionStorage.getItem(RELOADED_KEY) === '1'
      sessionStorage.setItem(RELOADED_KEY, '1')
    } catch {
      // sessionStorage throws in Safari private mode. Without the guard we
      // cannot prove we have not already reloaded, so do NOT reload - a loop is
      // worse than a message.
      return
    }

    if (!alreadyReloaded) window.location.reload()
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-gray-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-gray-600">
            The app may have been updated while this tab was open. Reloading
            usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => {
              // Clear the guard so the reload is allowed to happen: the user
              // asking for it explicitly is not the loop we are protecting
              // against.
              try {
                sessionStorage.removeItem(RELOADED_KEY)
              } catch {
                // Nothing to clear; reload anyway.
              }
              window.location.reload()
            }}
            className="mt-4 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
