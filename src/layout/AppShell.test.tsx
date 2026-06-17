// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import AppShell from './AppShell'

// Chrome and the non-food route pages pull in supabase/auth/queries at import.
// Stub them so this test stays focused on routing: that the food routes still
// resolve to their pages now that they are lazy-loaded (perf audit P3).
vi.mock('./NavBar', () => ({ default: () => null }))
vi.mock('./MobilePrimaryNav', () => ({ default: () => null }))
vi.mock('../components/PasskeyNudge', () => ({ default: () => null }))
vi.mock('./RootRedirect', () => ({ default: () => <div>Root</div> }))
vi.mock('../gear/GearLibraryPage', () => ({ default: () => <div>Gear page</div> }))
vi.mock('../lists/ListsPage', () => ({ default: () => <div>Lists page</div> }))
vi.mock('../lists/ListDetailPage', () => ({ default: () => <div>List detail page</div> }))
vi.mock('../settings/SettingsPage', () => ({ default: () => <div>Settings page</div> }))
vi.mock('../help/HelpPage', () => ({ default: () => <div>Help page</div> }))
// The two pages under test. lazy(() => import(...)) resolves to these mocks,
// so the assertions exercise the Suspense/lazy boundary (findBy is async).
vi.mock('../food/FoodLibraryPage', () => ({ default: () => <div>Food library page</div> }))
vi.mock('../food/FoodPlanPage', () => ({ default: () => <div>Food plan page</div> }))

afterEach(cleanup)

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
    </MemoryRouter>,
  )
}

describe('AppShell food routes', () => {
  it('resolves the lazy Food library page at /food', async () => {
    renderAt('/food')
    expect(await screen.findByText('Food library page')).toBeInTheDocument()
  })

  it('resolves the lazy Food plan page at /lists/:id/food', async () => {
    renderAt('/lists/abc/food')
    expect(await screen.findByText('Food plan page')).toBeInTheDocument()
  })

  it('still renders an eager primary route synchronously', () => {
    renderAt('/lists')
    expect(screen.getByText('Lists page')).toBeInTheDocument()
  })
})
