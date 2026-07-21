// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PackingLocation } from '../lib/types'
import LocationSection from './LocationSection'

function renderSection(location: PackingLocation, onDelete = vi.fn()) {
  render(
    <LocationSection
      location={location}
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
    })

    expect(screen.getByLabelText('Item-backed container')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Bear canister options' }))
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
})
