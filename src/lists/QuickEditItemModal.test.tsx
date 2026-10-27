// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import QuickEditItemModal from './QuickEditItemModal'
import type { GearItem, ListItemWithGear } from '../lib/types'

// The phone editor for a list row. The full inventory form (cost, purchase
// date, status, Delete from inventory) is too much to change one weight, so
// this modal carries only what list work needs; everything else is behind
// More details.

beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})

const gear: GearItem = {
  id: 'g1',
  name: 'Wind shirt',
  description: null,
  weightGrams: 150,
  categoryId: 'cat-1',
  cost: 120,
  purchaseDate: '2026-01-01',
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
}

const listItem: ListItemWithGear = {
  id: 'li1',
  listId: 'l1',
  gearItemId: 'g1',
  quantity: 2,
  isWorn: false,
  isConsumable: false,
  isPacked: false,
  isReady: false,
  packingLocationId: null,
  sortOrder: 0,
  packSortOrder: 0,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  gearItem: gear,
}

afterEach(() => cleanup())

function renderModal(over: Partial<React.ComponentProps<typeof QuickEditItemModal>> = {}) {
  const props = {
    gear,
    listItem,
    saving: false,
    saveError: null,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onMoreDetails: vi.fn(),
    ...over,
  }
  render(<QuickEditItemModal {...props} />)
  return props
}

describe('QuickEditItemModal', () => {
  it('carries only list-work fields; inventory administration stays out', () => {
    renderModal()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Weight')).toBeInTheDocument()
    expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /worn/i })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /consumable/i })).toBeInTheDocument()
    expect(screen.queryByText(/Cost/)).toBeNull()
    expect(screen.queryByText(/Purchase/)).toBeNull()
    expect(screen.queryByText(/Status/)).toBeNull()
    expect(screen.queryByText('Delete from inventory')).toBeNull()
  })

  it('saves the gear patch and the list patch together', async () => {
    const { onSave } = renderModal()
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Wind shirt XL')
    await userEvent.click(screen.getByRole('checkbox', { name: /worn/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith(
      { name: 'Wind shirt XL', weightGrams: 150 },
      { quantity: 2, isWorn: true, isConsumable: false },
    )
  })

  it('hands its current drafts to More details, so the switch loses nothing', async () => {
    // The switch unmounts this form; edits that silently vanish on the way
    // to "more" would be worse than no shortcut.
    const { onMoreDetails } = renderModal()
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Wind shirt XL')
    await userEvent.click(screen.getByRole('checkbox', { name: /worn/i }))
    await userEvent.click(screen.getByRole('button', { name: 'More details' }))
    expect(onMoreDetails).toHaveBeenCalledWith(
      { name: 'Wind shirt XL', weightGrams: 150 },
      { quantity: 2, isWorn: true, isConsumable: false },
    )
  })

  it('reports a save failure inline', () => {
    renderModal({ saveError: "Couldn't confirm those changes saved." })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't confirm those changes saved.")
  })
})
