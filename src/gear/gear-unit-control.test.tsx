// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { WEIGHT_UNIT_KEY } from '../lib/weight'
import { MobilePrimaryNavProvider } from '../layout/mobile-primary-nav-context'

// The gear page shows a weight on every row, so it carries the unit
// switcher - and for an account with gear but no lists yet it is the ONLY
// authenticated surface that can (the other switcher lives on the list
// toolbar, and Settings deliberately has none; see SettingsModal.test.tsx).
// Losing this control would strand that account on whatever unit the
// device last had.

const h = vi.hoisted(() => ({
  fetchGearItems: vi.fn(async () => []),
  fetchCategories: vi.fn(async () => []),
}))

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, fetchCategories: h.fetchCategories, fetchGearItems: h.fetchGearItems }
})

vi.mock('../lib/use-breakpoint', () => ({ useIsBelowLg: () => false }))

import GearLibraryPage from './GearLibraryPage'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MobilePrimaryNavProvider>{children}</MobilePrimaryNavProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(<GearLibraryPage />, { wrapper })
}

describe('gear page unit control', () => {
  it('carries one unit switcher that writes the app-wide preference', () => {
    localStorage.setItem(WEIGHT_UNIT_KEY, 'g')
    renderPage()

    expect(screen.getAllByRole('radiogroup', { name: 'Weight units' })).toHaveLength(1)

    fireEvent.click(screen.getByTitle('Imperial'))
    expect(localStorage.getItem(WEIGHT_UNIT_KEY)).toBe('oz')
  })

  it('stays usable with an empty library - the zero-list account needs it most', () => {
    // No gating on libraryReady: the preference is device-local, and the
    // account this control exists for is exactly the one with no data yet.
    renderPage()
    expect(screen.getByRole('radiogroup', { name: 'Weight units' })).toBeInTheDocument()
  })
})
