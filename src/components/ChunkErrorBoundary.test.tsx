// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChunkErrorBoundary from './ChunkErrorBoundary'

// jsdom refuses to navigate, so window.location.reload has to be replaced to be
// observed at all. Everything here turns on whether it was called.
const reload = vi.fn()

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  })
  // The boundary logs non-chunk errors, and React logs every caught error. Both
  // are expected here; silence them so a passing run is not a wall of red.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  vi.restoreAllMocks()
  reload.mockClear()
})

function Boom({ error }: { error: Error }): never {
  throw error
}

// The real thing: a tab open across a deploy asks for a chunk hash that no
// longer exists, the SPA fallback answers with index.html, and the browser fails
// to parse HTML as a module. This is what that rejection looks like.
const chunkError = new TypeError(
  'Failed to fetch dynamically imported module: https://grampacker.app/assets/AuthenticatedApp-A1b2C3d4.js',
)

describe('ChunkErrorBoundary', () => {
  it('reloads once on a stale-chunk error, to fetch a fresh index.html', () => {
    // Boom throws only once rendered, so this also proves the boundary
    // renders its children when nothing is wrong yet.
    render(
      <ChunkErrorBoundary>
        <Boom error={chunkError} />
      </ChunkErrorBoundary>,
    )
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does NOT reload a second time, so a broken deploy cannot loop', () => {
    // The guard that matters. Without it, a chunk that fails for any reason
    // OTHER than staleness reloads into the same failure, forever.
    sessionStorage.setItem('gp:chunk-reloaded', '1')
    render(
      <ChunkErrorBoundary>
        <Boom error={chunkError} />
      </ChunkErrorBoundary>,
    )
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
  })

  it('never auto-reloads on an ordinary render error', () => {
    // A bug in a component must not turn into a reload loop dressed up as a
    // stale deploy.
    render(
      <ChunkErrorBoundary>
        <Boom error={new Error('cannot read properties of undefined')} />
      </ChunkErrorBoundary>,
    )
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
  })

  it('lets the user reload by hand after the automatic one is spent', () => {
    sessionStorage.setItem('gp:chunk-reloaded', '1')
    render(
      <ChunkErrorBoundary>
        <Boom error={chunkError} />
      </ChunkErrorBoundary>,
    )
    screen.getByRole('button', { name: /reload/i }).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
