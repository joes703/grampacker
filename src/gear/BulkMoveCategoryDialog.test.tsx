// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BulkMoveCategoryDialog from './BulkMoveCategoryDialog'
import { unconfirmedId } from '../lib/unconfirmed-id'
import { shimDialog } from '../lists/test/list-detail-harness'

beforeAll(shimDialog)
afterEach(cleanup)

// A category whose create is still pending has no server row, so moving
// items into it would send an id the server does not know.
describe('BulkMoveCategoryDialog', () => {
  it('does not offer a category whose create is still pending', () => {
    render(
      <BulkMoveCategoryDialog
        categories={[
          { id: 'cat-1', name: 'Shelter', sortOrder: 0, createdAt: '2026-06-06' },
          { id: unconfirmedId(), name: 'Stoves', sortOrder: 1, createdAt: '2026-06-06' },
        ]}
        count={2}
        onMove={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const labels = [...screen.getByRole('combobox').querySelectorAll('option')].map((o) => o.textContent)
    expect(labels).toEqual(['Uncategorized', 'Shelter'])
  })
})
