// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { MemoryRouter, matchRoutes } from 'react-router'
import ListViewNav from './ListViewNav'
import { listDocumentTitle, persistedListPath } from './list-detail-mode'
import { LIST_DETAIL_ROUTES } from './list-detail-routes'

const LIST_ID = 'list-1'

// The route table decides the view. React Router matches case-insensitively
// and ignores trailing slashes, so these spellings must reach the right route.
describe('list detail routes', () => {
  const routes = Object.keys(LIST_DETAIL_ROUTES).map((path) => ({ path }))
  it.each([
    [`/lists/${LIST_ID}`, 'lists/:id'],
    [`/lists/${LIST_ID}/pack/`, 'lists/:id/pack'],
    [`/lists/${LIST_ID}/FOOD`, 'lists/:id/food'],
    [`/lists/${LIST_ID}/ORGANIZE/`, 'lists/:id/organize'],
    [`/LISTS/${LIST_ID}/pack/organize`, 'lists/:id/pack/organize'],
  ])('%s -> %s', (pathname, expected) => {
    expect(matchRoutes(routes, pathname)?.[0]?.route.path).toBe(expected)
  })
})

describe('persistedListPath', () => {
  it.each([
    ['edit', `/lists/${LIST_ID}`],
    ['pack', `/lists/${LIST_ID}/pack`],
  ] as const)('persists %s mode', (mode, expected) => {
    expect(persistedListPath(LIST_ID, mode)).toBe(expected)
  })

  it('persists the food view path', () => {
    expect(persistedListPath(LIST_ID, 'food')).toBe(`/lists/${LIST_ID}/food`)
  })
})

describe('listDocumentTitle', () => {
  afterEach(cleanup)

  // ListViewNav keeps its own copy of the view names. The title must use the
  // word on the tab the user is looking at.
  it('names every view the way its tab does', () => {
    for (const mode of ['edit', 'pack', 'food'] as const) {
      render(
        createElement(MemoryRouter, null, createElement(ListViewNav, { listId: LIST_ID, mode })),
      )
      const tab = screen.getByRole('link', { current: 'page' })
      expect(listDocumentTitle('Weekend Trip', mode)).toBe(`Weekend Trip - ${tab.textContent}`)
      cleanup()
    }
  })
})
