// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import ListViewNav from './ListViewNav'

afterEach(cleanup)

describe('ListViewNav', () => {
  it.each([
    ['edit', 'List'],
    ['organize', 'Organize'],
    ['pack', 'Pack'],
  ] as const)('offers direct links with %s marked current', (mode, currentLabel) => {
    render(
      <MemoryRouter>
        <ListViewNav listId="list-1" mode={mode} />
      </MemoryRouter>,
    )

    const nav = screen.getByRole('navigation', { name: 'List views' })
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['List', 'Organize', 'Pack'])
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/lists/list-1',
      '/lists/list-1/organize',
      '/lists/list-1/pack',
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
})
