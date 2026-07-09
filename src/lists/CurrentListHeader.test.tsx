// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'

vi.mock('./use-current-list-actions', () => ({
  useCurrentListActions: () => ({
    renameMut: { mutate: vi.fn() },
    draftMut: { mutate: vi.fn() },
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
  groupWorn: false,
  readyChecksEnabled: false,
  isDraft: true,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}

describe('CurrentListHeader', () => {
  it('groups draft status with the title rather than the rename action', () => {
    render(<CurrentListHeader list={list} />)

    const titleGroup = screen.getByRole('heading', { name: 'Test List' }).parentElement
    const draftButton = screen.getByRole('button', { name: 'Draft. Mark list complete' })
    const renameButton = screen.getByRole('button', { name: 'Rename list' })

    expect(draftButton.parentElement).toBe(titleGroup)
    expect(renameButton.parentElement).not.toBe(titleGroup)
  })
})
