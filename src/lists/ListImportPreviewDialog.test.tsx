// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { MAX_DESC_LENGTH } from '../lib/caps'
import type { ListCsvRow } from '../lib/csv'
import ListImportPreviewDialog from './ListImportPreviewDialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
  HTMLDialogElement.prototype.close = function close() { this.open = false }
})

afterEach(cleanup)

function row(over: Partial<ListCsvRow> = {}): ListCsvRow {
  return {
    name: 'Tent',
    description: null,
    weightGrams: 1200,
    quantity: 1,
    categoryName: 'Shelter',
    cost: null,
    isWorn: false,
    isConsumable: false,
    ...over,
  }
}

describe('ListImportPreviewDialog', () => {
  it('warns when imported descriptions will be shortened', () => {
    render(
      <ListImportPreviewDialog
        rows={[row({ description: 'x'.repeat(MAX_DESC_LENGTH + 1) })]}
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(
      screen.getByText('1 description longer than 2,000 characters will be shortened on import.'),
    ).toBeInTheDocument()
  })

  const PRICE_NOTICE =
    'Prices apply only to newly added gear. Items already in your library keep the price you already set.'

  it('explains that prices only apply to newly added gear', () => {
    // The rule is invisible otherwise: a matched row silently keeps its
    // stored price and ignores the file's.
    render(
      <ListImportPreviewDialog
        rows={[row({ name: 'Tent', cost: 27.29 })]}
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(PRICE_NOTICE)).toBeInTheDocument()
  })

  it('shows the price notice for a genuinely free item too', () => {
    // cost 0 is a real price, so the notice applies. A truthiness check
    // instead of a null check would drop it here.
    render(
      <ListImportPreviewDialog
        rows={[row({ name: 'Gifted mug', cost: 0 })]}
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(PRICE_NOTICE)).toBeInTheDocument()
  })

  it('omits the price notice when the file carries no prices', () => {
    // Don't raise a question the user doesn't have.
    render(
      <ListImportPreviewDialog
        rows={[row({ name: 'Tent', cost: null })]}
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByText(PRICE_NOTICE)).not.toBeInTheDocument()
  })

  it('summarizes worn/consumable counts and flags the rows', () => {
    render(
      <ListImportPreviewDialog
        rows={[
          row({ name: 'Shoes', isWorn: true }),
          row({ name: 'Trail mix', isConsumable: true }),
          row({ name: 'Tarp' }),
        ]}
        saving={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // Dedup subhead + per-flag counts in one paragraph.
    expect(
      screen.getByText(/Items already in the library won't be duplicated\. 1 worn\. 1 consumable\./),
    ).toBeInTheDocument()
    // Flags column: purple W for worn, orange C for consumable.
    expect(screen.getByText('W')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })
})
