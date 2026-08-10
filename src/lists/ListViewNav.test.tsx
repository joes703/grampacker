// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ListViewNav from './ListViewNav'

afterEach(cleanup)

describe('ListViewNav', () => {
  it.each([
    ['edit', 'Category'],
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
    // Category and Pack are two arrangements of the SAME rows; Food is a
    // different document. Ordering the two arrangements adjacently and putting
    // Food last is the cheap half of saying so.
    expect(links.map((link) => link.textContent)).toEqual(['Category', 'Pack', 'Food'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/lists/list-1',
      '/lists/list-1/pack',
      '/lists/list-1/food',
    ])
    expect(nav).toContainElement(
      screen.getByRole('link', { name: currentLabel, current: 'page' }),
    )
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1)
    expect(nav).toHaveClass('w-full', 'lg:w-auto')
    for (const link of links) {
      expect(link).toHaveClass('min-h-10', 'flex-1', 'lg:min-h-7', 'lg:flex-none')
    }
  })

  // The separator is decoration for a distinction the order already implies,
  // so it must not reach the accessibility tree as content or as a fourth
  // "thing" in a three-destination control.
  it('separates Food from the two arrangements without announcing it', () => {
    render(
      <MemoryRouter>
        <ListViewNav listId="list-1" mode="edit" />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: 'List views' })
    const separator = within(nav).getByTestId('list-view-nav-separator')
    expect(separator).toHaveAttribute('aria-hidden', 'true')
    expect(separator.textContent).toBe('')

    // It sits between Pack and Food, not anywhere else in the row.
    const order = Array.from(nav.children).map((el) =>
      el.getAttribute('data-testid') ?? el.textContent,
    )
    expect(order).toEqual(['Category', 'Pack', 'list-view-nav-separator', 'Food'])
  })
})
