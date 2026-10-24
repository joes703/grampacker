// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ListViewNav from './ListViewNav'

afterEach(cleanup)

describe('ListViewNav', () => {
  it.each([
    ['edit', 'List'],
    ['food', 'Food'],
    ['pack', 'Pack'],
  ] as const)('offers direct links with %s marked current', (mode, currentLabel) => {
    render(
      <MemoryRouter>
        <ListViewNav listId="list-1" mode={mode} />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: 'List views' })
    const links = screen.getAllByRole('link')
    // List and Pack are two arrangements of the SAME rows; Food is a
    // different document. Ordering the two arrangements adjacently and putting
    // Food last is the cheap half of saying so.
    expect(links.map((link) => link.textContent)).toEqual(['List', 'Pack', 'Food'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/lists/list-1',
      '/lists/list-1/pack',
      '/lists/list-1/food',
    ])
    expect(nav).toContainElement(
      screen.getByRole('link', { name: currentLabel, current: 'page' }),
    )
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1)
  })

  // Underline tabs, not a segmented control: the g/oz picker beside them is
  // a segmented control, and a view switch must not look like a setting.
  it('draws the views as underline tabs at both density tiers', () => {
    render(
      <MemoryRouter>
        <ListViewNav listId="list-1" mode="pack" />
      </MemoryRouter>,
    )

    const current = screen.getByRole('link', { name: 'Pack', current: 'page' })
    expect(current).toHaveClass('border-b-2', 'border-blue-600', 'text-blue-700')
    expect(current).not.toHaveClass('bg-white')
    const other = screen.getByRole('link', { name: 'List' })
    expect(other).toHaveClass('border-b-2', 'border-transparent')
    for (const link of screen.getAllByRole('link')) {
      expect(link).toHaveClass('min-h-11', 'lg:min-h-8')
    }
  })
})
