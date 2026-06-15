// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import ListWorkspaceTabs from './ListWorkspaceTabs'

afterEach(() => cleanup())

function renderTabs(active: React.ComponentProps<typeof ListWorkspaceTabs>['active'] = 'gear') {
  render(
    <MemoryRouter>
      <ListWorkspaceTabs listId="list-1" active={active} />
    </MemoryRouter>,
  )
}

describe('ListWorkspaceTabs', () => {
  it('links Pack to the stable pack route', () => {
    renderTabs()

    expect(screen.getByRole('link', { name: 'Gear list' })).toHaveAttribute('href', '/lists/list-1')
    expect(screen.getByRole('link', { name: 'Food plan' })).toHaveAttribute('href', '/lists/list-1/food')
    expect(screen.getByRole('link', { name: 'Pack' })).toHaveAttribute('href', '/lists/list-1/pack')
  })

  it('marks Pack as the current workspace tab', () => {
    renderTabs('pack')

    expect(screen.getByRole('link', { name: 'Pack' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Gear list' })).not.toHaveAttribute('aria-current')
  })
})
