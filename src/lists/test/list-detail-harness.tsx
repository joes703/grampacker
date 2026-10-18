import { vi } from 'vitest'
import { makeList } from '../../test/fixtures'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { ReactNode } from 'react'
import type { ListFoodResponse } from '../../../shared/food'
import { MobilePrimaryNavProvider } from '../../layout/mobile-primary-nav-context'
import { SidebarDrawerProvider } from '../../layout/sidebar-drawer-context'

// Shared setup for the ListDetailPage.*.test.tsx files, which mount the real
// page. The module mocks cannot live here: vi.mock is hoisted only inside the
// test file that calls it. Each of those files therefore mocks two modules
// itself:
//
// - '../lib/queries', to answer the page's reads and record its writes.
// - '../lib/auth-client'. The page calls authClient.useSession(), which mounts
//   better-auth's nanostores session atom. Nanostores keeps an unmounted store
//   alive on a ~1s timer. When that timer fires AFTER vitest has torn down the
//   file's jsdom environment, better-auth's cleanupBroadcastSetup touches
//   `window` and throws an unhandled ReferenceError. CI then fails with every
//   test passing. With the client mocked, the atom never mounts.

export const listId = 'list-1'

export const list = makeList({
  id: listId,
  name: 'Sierra High Route',
  isShared: false,
  description: null,
  updatedAt: '2026-07-01T00:00:00.000Z',
})

export const emptyFood: ListFoodResponse = { dayCount: 0, slots: [], items: [] }

// jsdom has no matchMedia, and the page reads breakpoints to decide which of
// the mobile and desktop surfaces to mount. This answers the `width < Nrem`
// queries as a viewport `width` CSS pixels wide.
export function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const m = /width\s*<\s*([\d.]+)rem/.exec(query)
    return {
      matches: m ? width < Number(m[1]) * 16 : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

// jsdom implements <dialog> without its modal methods, and the page's editors
// open through Modal. Call it from beforeAll.
export function shimDialog() {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
}

export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

export function ListDetailProviders({
  client,
  children,
}: {
  client: QueryClient
  children: ReactNode
}) {
  return (
    <QueryClientProvider client={client}>
      <MobilePrimaryNavProvider>
        <SidebarDrawerProvider>{children}</SidebarDrawerProvider>
      </MobilePrimaryNavProvider>
    </QueryClientProvider>
  )
}

// Renders the page at `path`, with one route per pattern in `routes`. Only
// these routes exist, so a test controls which URLs the page can reach.
// `beside` renders next to the page inside every route, for a probe that
// needs the router. Returns the query client, so a test can seed or refetch.
export async function renderListDetailPage(
  path: string,
  routes: readonly string[],
  { client = testQueryClient(), beside }: { client?: QueryClient; beside?: ReactNode } = {},
): Promise<QueryClient> {
  // Imported lazily so the test file's module mocks are installed first.
  const { default: ListDetailPage } = await import('../ListDetailPage')
  const page =
    beside === undefined ? (
      <ListDetailPage />
    ) : (
      <>
        <ListDetailPage />
        {beside}
      </>
    )
  render(
    <ListDetailProviders client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {routes.map((pattern) => (
            <Route key={pattern} path={pattern} element={page} />
          ))}
        </Routes>
      </MemoryRouter>
    </ListDetailProviders>,
  )
  return client
}
