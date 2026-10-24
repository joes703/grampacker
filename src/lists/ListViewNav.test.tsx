// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ListViewNav from './ListViewNav'

afterEach(cleanup)

describe('ListViewNav', () => {
  it.each([
    ['edit', 'Gear'],
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
    // Gear and Pack are two arrangements of the SAME rows; Food is a
    // different document. Ordering the two arrangements adjacently and putting
    // Food last is the cheap half of saying so.
    expect(links.map((link) => link.textContent)).toEqual(['Gear', 'Pack', 'Food'])
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
})
