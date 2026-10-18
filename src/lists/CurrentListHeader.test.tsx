// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'

vi.mock('./use-current-list-actions', () => ({
  useCurrentListActions: () => ({
    renameMut: { mutate: vi.fn() },
    draftToggle: { toggle: vi.fn(), isPending: false },
  }),
}))

afterEach(() => {
  cleanup()
})

const list: List = {
  id: 'list-1',
  name: 'Test List',
  description: null,
  slug: 'test-list',
  isShared: false,
  sortOrder: 0,
  isDraft: true,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}

describe('CurrentListHeader', () => {
  it('shows the document heading and named draft/rename actions', () => {
    render(<CurrentListHeader list={list} />)
    expect(screen.getAllByRole('heading', { level: 1, name: 'Test List' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Draft. Mark list complete' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Rename list' })).toBeEnabled()
  })
})
