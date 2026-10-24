// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { List } from '../lib/types'

// Hoisted so the mock factory and the test bodies share the same spies.
const actions = vi.hoisted(() => ({
  renameMutate: vi.fn(),
  duplicateMutate: vi.fn(),
  deleteMutate: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('./PrivacyPanel', () => ({ default: () => <div>sharing controls</div> }))
vi.mock('./use-current-list-actions', () => ({
  useCurrentListActions: () => ({
    renameMut: { mutate: actions.renameMutate, isPending: false },
    duplicateMut: { mutate: actions.duplicateMutate, isPending: false },
    deleteListMut: { mutate: actions.deleteMutate, isPending: false },
    exportCsv: actions.exportCsv,
    exportingListId: null,
  }),
}))

import ListSettingsPanel from './ListSettingsPanel'

// jsdom implements <dialog> without its modal methods, and the delete confirm
// is a Modal. Same shim the ListDetailPage suites use.
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

beforeEach(() => {
  for (const spy of Object.values(actions)) spy.mockReset()
})

afterEach(cleanup)

const list: List = {
  id: 'list-1',
  name: 'Trip',
  description: null,
  slug: 'trip',
  isShared: false,
  isDraft: false,
  sortOrder: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

function LocationProbe() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function renderPanel(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/lists/list-1']}>
      <Routes>
        <Route path="*" element={<ListSettingsPanel list={list} onClose={onClose} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  )
  return onClose
}

describe('ListSettingsPanel worn grouping', () => {
  it('does not offer a toggle for the always-on Worn section', () => {
    renderPanel()

    expect(screen.queryByRole('switch', { name: 'Group worn items' })).not.toBeInTheDocument()
  })
})

describe('ListSettingsPanel sharing', () => {
  it('no longer hosts the share controls - the toolbar Share button is their one home', () => {
    renderPanel()

    expect(screen.queryByText('Shared')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Enable public link' })).toBeNull()
    // Draft moved with them: it only changes what a share's visitors see.
    expect(screen.queryByRole('switch', { name: 'Draft' })).toBeNull()
  })
})

// On mobile the panel sits in a Modal; Duplicate and Export close it on the click.
describe('ListSettingsPanel actions that can fail', () => {
  it.each([
    ['Duplicate', () => actions.duplicateMutate],
    ['Export CSV', () => actions.exportCsv],
  ])('%s closes the host before it acts', async (name, spy) => {
    const onClose = renderPanel()
    await userEvent.click(screen.getByRole('button', { name }))

    expect(spy()).toHaveBeenCalledWith(list)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(spy().mock.invocationCallOrder[0]!)
  })

  it('Delete list leaves for /lists on the confirm, without waiting for the delete to settle', async () => {
    // deleteMutate is inert: the request never settles. Navigating in a per-call
    // onSuccess never happened in the app either - the optimistic removal
    // unmounts this panel first, and an unmounted observer drops per-call
    // callbacks.
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Delete list' }))
    const confirm = screen.getByRole('dialog', { name: 'Delete list' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete list' }))

    expect(actions.deleteMutate).toHaveBeenCalledWith('list-1')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/lists$/)
  })
})
