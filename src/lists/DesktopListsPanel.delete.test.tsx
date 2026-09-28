// @vitest-environment jsdom

// Where deleting from the desktop Lists panel lands. The navigation happens on
// the confirm click: deleting the OPEN list swaps ListDetailPage to "List not
// found", which unmounts this panel, and an unmounted mutation observer never
// runs a per-call onSuccess - so the delete below is deliberately inert.

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { List } from '../lib/types'

const deleteMutate = vi.hoisted(() => vi.fn())

vi.mock('./use-current-list-actions', () => ({
  useCurrentListActions: () => ({
    createListMut: { isPending: false },
    submitCreateList: vi.fn(),
    renameMut: { mutate: vi.fn(), isPending: false },
    duplicateMut: { mutate: vi.fn(), isPending: false },
    deleteListMut: { mutate: deleteMutate, isPending: false },
    exportCsv: vi.fn(),
    exportingListId: null,
  }),
}))
vi.mock('./use-list-import-mutation', () => ({
  useListImportMutation: () => ({ mutate: vi.fn(), isPending: false }),
}))
// The panel's lists subscription and reorder machine; the seed is all this
// suite needs.
vi.mock('../lib/use-reorderable', () => ({
  useReorderable: ({ initialData }: { initialData: List[] }) => ({
    items: initialData,
    activeItem: null,
    reorderPending: false,
    handleDragStart: vi.fn(),
    handleDragCancel: vi.fn(),
    handleDragEnd: vi.fn(),
  }),
}))
vi.mock('../lib/queries', () => ({
  queryKeys: { lists: () => ['lists'] },
  fetchLists: vi.fn(),
  reorderLists: vi.fn(),
}))

import DesktopListsPanel from './DesktopListsPanel'

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

beforeEach(() => deleteMutate.mockReset())
afterEach(cleanup)

function makeList(id: string, sortOrder: number): List {
  return {
    id,
    name: `List ${id}`,
    description: null,
    slug: id,
    isShared: false,
    isDraft: false,
    sortOrder,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderPanel(lists: List[], currentListId: string) {
  render(
    <MemoryRouter initialEntries={[`/lists/${currentListId}`]}>
      <Routes>
        <Route path="*" element={<DesktopListsPanel lists={lists} currentListId={currentListId} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
}

async function deleteRow(index: number) {
  const kebab = screen.getAllByRole('button', { name: 'List options' })[index]!
  await userEvent.click(kebab)
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
  const confirm = screen.getByRole('dialog', { name: 'Delete list' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete list' }))
}

describe('DesktopListsPanel delete navigation', () => {
  it('moves off the open list to its successor on the confirm, without waiting for the delete', async () => {
    renderPanel([makeList('a', 0), makeList('b', 1)], 'a')
    await deleteRow(0)

    expect(deleteMutate).toHaveBeenCalledWith('a')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists\/b$/)
  })

  it('falls back to /lists when the open list was the only one', async () => {
    renderPanel([makeList('a', 0)], 'a')
    await deleteRow(0)

    expect(deleteMutate).toHaveBeenCalledWith('a')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists$/)
  })

  it('stays put when deleting a list that is not the open one', async () => {
    renderPanel([makeList('a', 0), makeList('b', 1)], 'a')
    await deleteRow(1)

    expect(deleteMutate).toHaveBeenCalledWith('b')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists\/a$/)
  })
})
