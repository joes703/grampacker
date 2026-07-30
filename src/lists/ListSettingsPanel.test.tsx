// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import type { List } from '../lib/types'

vi.mock('./PrivacyPanel', () => ({ default: () => <div>sharing controls</div> }))
vi.mock('./use-current-list-actions', () => ({
  useCurrentListActions: () => ({
    renameMut: { mutate: vi.fn(), isPending: false },
    duplicateMut: { mutate: vi.fn(), isPending: false },
    deleteListMut: { mutate: vi.fn(), isPending: false },
    exportCsv: vi.fn(),
    exportingListId: null,
    draftToggle: { toggle: vi.fn(), isPending: false },
  }),
}))

import ListSettingsPanel from './ListSettingsPanel'

afterEach(cleanup)

describe('ListSettingsPanel worn grouping', () => {
  it('does not offer a toggle for the always-on Worn section', () => {
    const list: List = {
      id: 'list-1',
      name: 'Trip',
      description: null,
      slug: 'trip',
      isShared: false,
      isDraft: false,
      groupWorn: false,
      readyChecksEnabled: false,
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }

    render(
      <MemoryRouter>
        <ListSettingsPanel list={list} />
      </MemoryRouter>,
    )

    expect(screen.getByRole('switch', { name: 'Draft' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Group worn items' })).not.toBeInTheDocument()
  })
})
