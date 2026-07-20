// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Category, GearItem } from '../lib/types'
import LibraryPanel from './LibraryPanel'

afterEach(() => {
  cleanup()
})

const item: GearItem = {
  id: 'gear-1',
  categoryId: 'cat-1',
  name: 'Tarp',
  description: null,
  weightGrams: 250.5,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
}

const category: Category = {
  id: 'cat-1',
  name: 'Shelter',
  sortOrder: 0,
  createdAt: '2026-06-06T00:00:00.000Z',
}

// The picker's group header showed a bare item count (no parens, unlike the
// other surfaces). It was removed along with every other plain category
// membership count. The group component is not exported, so this drives it
// through the panel - which is also the honest integration: the count only
// ever appeared as a result of the panel grouping items by category.
describe('gear picker group header carries no membership count', () => {
  it('renders the category name with no count beside it', () => {
    render(
      <LibraryPanel
        gearItems={[item, { ...item, id: 'gear-2', name: 'Stakes' }]}
        categories={[category]}
        listItemGearIds={new Set()}
        weightUnit="g"
        onAdd={vi.fn()}
        onRemove={vi.fn()}
      />,
    )
    const chevron = screen.getByRole('button', { name: /Collapse Shelter/ })
    const header = chevron.closest('div')!
    // Scoped to the header: the item rows below legitimately render weights
    // like "250.5 g", so a document-wide digit assertion would fail for the
    // wrong reason.
    expect(header.textContent).not.toMatch(/\d/)
  })
})
