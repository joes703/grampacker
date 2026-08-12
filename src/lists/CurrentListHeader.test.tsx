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
  it('renders the list name as the document heading', () => {
    render(<CurrentListHeader list={list} />)

    expect(screen.getAllByRole('heading', { level: 1, name: 'Test List' })).toHaveLength(1)
  })

  it('groups draft status with the title rather than the rename action', () => {
    render(<CurrentListHeader list={list} />)

    const titleGroup = screen.getByRole('heading', { name: 'Test List' }).parentElement
    const draftButton = screen.getByRole('button', { name: 'Draft. Mark list complete' })
    const renameButton = screen.getByRole('button', { name: 'Rename list' })

    expect(draftButton.parentElement).toBe(titleGroup)
    expect(renameButton.parentElement).not.toBe(titleGroup)
  })

  it('keeps the rename entry point visible and touch-safe below lg', () => {
    render(<CurrentListHeader list={list} />)

    const renameButton = screen.getByRole('button', { name: 'Rename list' })
    expect(renameButton).toHaveClass('h-10', 'w-10', 'lg:h-7', 'lg:w-6')
    expect(renameButton).toHaveClass('opacity-100', 'lg:opacity-0', 'lg:group-hover:opacity-100')
    expect(renameButton.className).not.toContain('md:opacity-0')
  })
})
