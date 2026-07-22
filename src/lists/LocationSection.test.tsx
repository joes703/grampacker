// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ListItemWithGear, PackingLocation } from '../lib/types'
import LocationSection from './LocationSection'

afterEach(cleanup)

function containerItem(id: string, name: string): ListItemWithGear {
  return {
    id,
    listId: 'list-1',
    gearItemId: `gear-${id}`,
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    gearItem: {
      id: `gear-${id}`,
      name,
      description: null,
      weightGrams: 100,
      categoryId: null,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
  }
}

function renderSection(
  location: PackingLocation,
  onDelete = vi.fn(),
  backingItem?: ListItemWithGear,
) {
  render(
    <LocationSection
      location={location}
      containerItem={backingItem}
      dragHandle={backingItem ? <button type="button" aria-label={`Reorder ${backingItem.gearItem.name}`} /> : undefined}
      nestHandle={backingItem ? <button type="button" aria-label={`Move ${backingItem.gearItem.name} into another container`} /> : undefined}
      items={[]}
      locations={[location]}
      mobile={false}
      movePending={false}
      containerCreationDisabled={false}
      containerItemIds={new Set()}
      onRename={vi.fn()}
      onDelete={onDelete}
      onMove={vi.fn()}
      onUseAsContainer={vi.fn()}
    />,
  )
  return onDelete
}

describe('LocationSection item-backed actions', () => {
  it('identifies an item-backed location and stops its role instead of renaming it', async () => {
    const user = userEvent.setup()
    const onDelete = renderSection({
      id: 'loc-canister',
      name: 'Bear canister',
      sortOrder: 0,
      containerListItemId: 'item-canister',
    }, vi.fn(), containerItem('item-canister', 'Bear canister'))

    expect(screen.getByLabelText('Item-backed container')).toBeInTheDocument()
    expect(screen.getAllByText('Bear canister')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Reorder Bear canister' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Bear canister into another container' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Bear canister packing options' }))
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop using as container' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('retains rename and delete for a name-only location', async () => {
    const user = userEvent.setup()
    renderSection({
      id: 'loc-pocket',
      name: 'Side pocket',
      sortOrder: 0,
      containerListItemId: null,
    })

    await user.click(screen.getByRole('button', { name: 'Side pocket options' }))
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete location' })).toBeInTheDocument()
  })

  it('keeps a filtered worn backing item read-only while retaining its container role', async () => {
    const user = userEvent.setup()
    renderSection({
      id: 'loc-jacket',
      name: 'Rain jacket',
      sortOrder: 0,
      containerListItemId: 'item-jacket',
    })

    await user.click(screen.getByRole('button', { name: 'Rain jacket options' }))
    expect(screen.getByRole('button', { name: 'Stop using as container' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete location' })).not.toBeInTheDocument()
  })
})
