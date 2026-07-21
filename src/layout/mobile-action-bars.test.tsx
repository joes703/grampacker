// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { List } from '../lib/types'
import MobilePrimaryNav from './MobilePrimaryNav'
import { MobilePrimaryNavProvider } from './mobile-primary-nav-context'
import { SidebarDrawerProvider } from './sidebar-drawer-context'
import MobilePlanActionBar from '../food/MobilePlanActionBar'
import MobileListActionBar from '../lists/MobileListActionBar'

afterEach(cleanup)

const list: List = {
  id: 'list-1',
  name: 'Weekend trip',
  description: null,
  slug: 'weekend-trip',
  foodPlanId: null,
  isShared: false,
  sortOrder: 0,
  groupWorn: false,
  readyChecksEnabled: false,
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
    render(<MobilePrimaryNav />, { wrapper: wrapper('/settings') })
    expect(labels('Primary navigation')).toEqual(['Gear', 'Lists', 'Food'])
    expect(screen.queryByLabelText(/no action/i)).toBeNull()
  })

  it('does not reserve a future Options slot on Plans', () => {
    render(<MobilePlanActionBar onNewPlan={vi.fn()} />, { wrapper: wrapper('/food/plans') })
    expect(labels('Plans navigation and actions')).toEqual(['Gear', 'Lists', 'Food', 'Add'])
  })

  it.each([
    ['edit', ['Gear', 'Lists', 'Food', 'Add', 'Options']],
    ['pack', ['Gear', 'Lists', 'Food', 'Add']],
    ['organize', ['Gear', 'Lists', 'Food']],
  ] as const)('renders the deliberate %s list-mode bar', (mode, expected) => {
    render(<MobileListActionBar list={list} mode={mode} />, {
      wrapper: wrapper(`/lists/${list.id}`),
    })
    expect(labels('List navigation and actions')).toEqual(expected)
  })
})
