// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Outlet } from 'react-router'

vi.mock('./layout/AppShell', () => ({
  default: () => <Outlet />,
}))
vi.mock('./layout/RootRedirect', () => ({ default: () => <div>root</div> }))
vi.mock('./gear/GearLibraryPage', () => ({ default: () => <div>gear</div> }))
vi.mock('./food/FoodLibraryPage', () => ({ default: () => <div>food-library</div> }))
vi.mock('./food/FoodPlansPage', () => ({ default: () => <div>food-plans</div> }))
vi.mock('./food/FoodPlanEditor', () => ({ default: () => <div>food-plan-editor</div> }))
vi.mock('./settings/SettingsPage', () => ({ default: () => <div>settings</div> }))
vi.mock('./lists/ListsPage', () => ({ default: () => <div>lists</div> }))
vi.mock('./lists/ListDetailPage', () => ({ default: () => <div>list-detail</div> }))

import AuthenticatedApp from './AuthenticatedApp'

afterEach(cleanup)

describe('parked Food workspace routes', () => {
  it.each(['/food', '/food/plans', '/food/plans/plan-1'])(
    'redirects bookmarked route %s to Lists',
    async (path) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AuthenticatedApp />
        </MemoryRouter>,
      )

      expect(await screen.findByText('lists')).toBeInTheDocument()
      expect(screen.queryByText('food-library')).not.toBeInTheDocument()
      expect(screen.queryByText('food-plans')).not.toBeInTheDocument()
      expect(screen.queryByText('food-plan-editor')).not.toBeInTheDocument()
    },
  )
})
