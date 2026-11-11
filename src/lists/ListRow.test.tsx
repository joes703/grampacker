// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SortableListRow, type ListRowActions } from './ListRow'
import { unconfirmedId } from '../lib/unconfirmed-id'
import type { List } from '../lib/types'

afterEach(cleanup)

const actions: ListRowActions = {
  renaming: false,
  renameDraft: '',
  onRenameDraftChange: vi.fn(),
  onStartRename: vi.fn(),
  onSubmitRename: vi.fn(),
  onCancelRename: vi.fn(),
  onExport: vi.fn(),
  exporting: false,
  onDuplicate: vi.fn(),
  onDelete: vi.fn(),
}

function list(id: string): List {
  return {
    id,
    name: 'Sierra',
    description: null,
    slug: '',
    sortOrder: 0,
    isShared: false,
    isDraft: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }
}

function renderRow(id: string) {
  render(
    <MemoryRouter>
      <ul>
        <SortableListRow list={list(id)} variant="panel" actions={actions} />
      </ul>
    </MemoryRouter>,
  )
}

// A pending create's row is in the lists cache so it shows at once, but no
// list has its id yet: opening it lands on "List not found", and every menu
// action or drag would send an id the server does not know.
describe('a list row whose create is still pending', () => {
  it('is not a link, its menu is disabled, and it cannot be dragged', () => {
    renderRow(unconfirmedId())
    expect(screen.getByText('Sierra')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open Sierra' })).toBeNull()
    expect(screen.getByRole('button', { name: 'List options' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reorder Sierra' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('a confirmed row links, and its menu and drag work (control)', () => {
    renderRow('list-1')
    expect(screen.getByRole('link', { name: 'Open Sierra' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List options' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reorder Sierra' })).toHaveAttribute('aria-disabled', 'false')
  })
})
