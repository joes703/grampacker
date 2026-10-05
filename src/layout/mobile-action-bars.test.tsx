// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { List } from '../lib/types'
import MobilePrimaryNav from './MobilePrimaryNav'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import MobileListActionBar from '../lists/MobileListActionBar'

afterEach(cleanup)

const list: List = {
  id: 'list-1',
  name: 'Weekend trip',
  description: null,
  slug: 'weekend-trip',
  isShared: false,
  sortOrder: 0,
  isDraft: false,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function wrapper(pathname: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[pathname]}>
          <SidebarDrawerProvider>
            <MobilePrimaryNavProvider>{children}</MobilePrimaryNavProvider>
          </SidebarDrawerProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

function labels(name: string): string[] {
  const nav = screen.getByRole('navigation', { name })
  return [...nav.querySelectorAll('a, button')].map((control) => control.textContent?.trim() ?? '')
}

describe('mobile action-bar contracts', () => {
  it('shows only working destinations on routes without page actions', () => {
    // Nothing registers a page bar here, as on a list-detail terminal state
    // (list not found) that mounts no rich bar. The labels and their order
    // come from buildMobileDestinationItems; the pathname only marks one active.
    render(<MobilePrimaryNav />, { wrapper: wrapper('/lists/missing-list') })
    expect(labels('Primary navigation')).toEqual(['Gear', 'Lists'])
    expect(screen.queryByLabelText(/no action/i)).toBeNull()
  })

  // Food gets destinations only: it has no drawer registration (nothing to
  // add gear to there), so an Add would render permanently disabled, and
  // list admin is not a food-view concern. The exact label list fails for any
  // Add, labeled or empty.
  it.each([
    ['edit', ['Gear', 'Lists', 'Add', 'Options']],
    ['pack', ['Gear', 'Lists', 'Add']],
    ['food', ['Gear', 'Lists']],
  ] as const)('renders the deliberate %s list-mode bar', (mode, expected) => {
    render(<MobileListActionBar list={list} mode={mode} />, {
      wrapper: wrapper(`/lists/${list.id}`),
    })
    expect(labels('List navigation and actions')).toEqual(expected)
  })
})
