// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { List } from '../lib/types'
import CurrentListHeader from './CurrentListHeader'

vi.mock('../auth/use-require-session', () => ({
  useRequireSession: () => ({ userId: 'user-1' }),
}))

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
  user_id: 'user-1',
  name: 'Test List',
  description: null,
  slug: 'test-list',
  is_shared: false,
  sort_order: 0,
  group_worn: false,
  ready_checks_enabled: false,
  is_draft: true,
  created_at: '2026-06-06T00:00:00.000Z',
  updated_at: '2026-06-06T00:00:00.000Z',
}

describe('CurrentListHeader', () => {
  it('groups draft status with the title rather than the rename action', () => {
    render(<CurrentListHeader list={list} />)

    const titleGroup = screen.getByRole('heading', { name: 'Test List' }).parentElement
    const draftButton = screen.getByRole('button', { name: 'Mark list complete' })
    const renameButton = screen.getByRole('button', { name: 'Rename list' })

    expect(draftButton.parentElement).toBe(titleGroup)
    expect(renameButton.parentElement).not.toBe(titleGroup)
  })
})
