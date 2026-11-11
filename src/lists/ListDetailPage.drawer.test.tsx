// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useNavigate } from 'react-router'
import { makeList } from '../test/fixtures'
import { renderListDetailPage, shimDialog, stubViewport } from './test/list-detail-harness'

// The phone's "Add gear to list" button lives in the bottom action bar, and
// the drawer it opens is rendered by ListDetailPage. Add is offered in Edit
// and Pack; Food has nothing to add gear to, so the drawer must not stay
// open there, and must not reopen by itself when the user comes back.

const listId = 'list-1'
const list = makeList({ id: listId, name: 'Sierra High Route' })

const h = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchListItems: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  fetchPackingLocations: vi.fn(),
  fetchListFood: vi.fn(),
}))

// Keeps better-auth's session atom from mounting (test/list-detail-harness.tsx
// explains why).
vi.mock('../lib/auth-client', async () =>
  (await import('../test/auth-client-mock')).signedInAuthClient)

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return { ...actual, ...h }
})

// A way to change the URL from outside the page, as the browser's back
// button would.
function NavigateProbe() {
  const navigate = useNavigate()
  return (
    <>
      <button onClick={() => void navigate(`/lists/${listId}/food`)}>probe: food</button>
      <button onClick={() => void navigate(`/lists/${listId}`)}>probe: edit</button>
    </>
  )
}

const drawer = () => screen.queryByRole('dialog', { name: 'Add from gear' })

beforeAll(shimDialog)

beforeEach(() => {
  stubViewport(390)
  h.fetchLists.mockResolvedValue([list])
  h.fetchListItems.mockResolvedValue([])
  h.fetchGearItems.mockResolvedValue([])
  h.fetchCategories.mockResolvedValue([])
  h.fetchPackingLocations.mockResolvedValue([])
  h.fetchListFood.mockResolvedValue({ dayCount: 0, slots: [], items: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('the mobile Add gear drawer', () => {
  it('opens from the bottom bar, closes in Food, and stays closed on the way back', async () => {
    await renderListDetailPage(`/lists/${listId}`, ['/lists/:id', '/lists/:id/food'], {
      beside: <NavigateProbe />,
    })
    const add = await screen.findByRole('button', { name: 'Add gear to list' })
    await waitFor(() => expect(add).toBeEnabled())
    expect(drawer()).toBeNull()

    fireEvent.click(add)
    expect(await screen.findByRole('dialog', { name: 'Add from gear' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'probe: food' }))
    await waitFor(() => expect(drawer()).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: 'probe: edit' }))
    await screen.findByRole('button', { name: 'Add gear to list' })
    expect(drawer()).toBeNull()
  })
})
