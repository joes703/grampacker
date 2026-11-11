// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SortableCategorySection } from './CategorySection'
import { unconfirmedId } from '../lib/unconfirmed-id'
import type { Category } from '../lib/types'

afterEach(cleanup)

// A pending category create's section is in the cache so it shows at once,
// but it has no server row yet: rename, delete and drag would each send an id
// the server does not know.
function renderSection(category: Category) {
  render(
    <SortableCategorySection
      id={category.id}
      category={category}
      items={[]}
      weightUnit="g"
      isBelowLg={false}
      collapsed={false}
      onToggleCollapse={vi.fn()}
      selectMode={false}
      selectedIds={new Set()}
      onToggleSelect={vi.fn()}
      onInlineSave={vi.fn()}
      onEditItem={vi.fn()}
      onDeleteItem={vi.fn()}
      onSetItemStatus={vi.fn()}
      onRenameCategory={vi.fn()}
      onDeleteCategory={vi.fn()}
    />,
  )
}

const category = (id: string): Category => ({
  id,
  name: 'Stoves',
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
})

describe('a category section whose create is still pending', () => {
  it('offers no rename, options menu or drag', () => {
    renderSection(category(unconfirmedId()))
    expect(screen.getByText('Stoves')).toBeInTheDocument()
    expect(screen.queryByTitle('Rename category')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Category options' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reorder Stoves' })).toBeNull()
  })

  it('a confirmed section offers all three (control)', () => {
    renderSection(category('cat-1'))
    expect(screen.getByTitle('Rename category')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Category options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Stoves' })).toBeInTheDocument()
  })
})
