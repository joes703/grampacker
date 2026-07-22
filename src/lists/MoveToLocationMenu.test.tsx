// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PackingLocation } from '../lib/types'
import { useIsBelowLg } from '../lib/use-breakpoint'
import MoveToLocationMenu from './MoveToLocationMenu'

HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
HTMLDialogElement.prototype.close = function close() { this.open = false }

const locations: PackingLocation[] = [
  {
    id: 'loc-main',
    name: 'Main pack',
    sortOrder: 0,
    containerListItemId: null,
  },
  {
    id: 'loc-canister',
    name: 'Bear canister',
    sortOrder: 1,
    containerListItemId: 'item-canister',
  },
]

function stubViewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)?.[1]
    return {
      matches: max !== undefined && width <= Number(max),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
  })
}

function MenuHarness({ onUseAsContainer }: { onUseAsContainer: () => void }) {
  const mobile = useIsBelowLg()
  return (
    <MoveToLocationMenu
      itemId="item-pot"
      itemName="Cooking pot"
      currentLocationId={null}
      locations={locations}
      mobile={mobile}
      disabled={false}
      containerCreationDisabled={false}
      isContainer={false}
      onMove={vi.fn()}
      onUseAsContainer={onUseAsContainer}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MoveToLocationMenu container actions', () => {
  it.each([390, 767, 768, 800, 1023, 1024, 1440])(
    'offers promotion and invokes it at %ipx',
    async (width) => {
      stubViewport(width)
      const user = userEvent.setup()
      const onUseAsContainer = vi.fn()
      render(<MenuHarness onUseAsContainer={onUseAsContainer} />)

      await user.click(screen.getByRole('button', { name: 'Open Cooking pot packing options' }))
      await user.click(screen.getByRole('button', { name: 'Use as container' }))

      expect(onUseAsContainer).toHaveBeenCalledTimes(1)
    },
  )

  it('does not offer promotion twice or allow an item to move into itself', async () => {
    const user = userEvent.setup()
    stubViewport(390)
    render(
      <MoveToLocationMenu
        itemId="item-canister"
        itemName="Bear canister"
        currentLocationId={null}
        locations={locations}
        mobile
        disabled={false}
        containerCreationDisabled={false}
        isContainer
        onMove={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Open Bear canister packing options' }))

    expect(screen.queryByRole('button', { name: 'Use as container' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bear canister' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Main pack' })).toBeInTheDocument()
  })

  it('does not offer a descendant location that would create a cycle', async () => {
    const user = userEvent.setup()
    stubViewport(1024)
    render(
      <MoveToLocationMenu
        itemId="item-pack"
        itemName="Main pack"
        currentLocationId={null}
        locations={locations}
        mobile={false}
        disabled={false}
        containerCreationDisabled={false}
        isContainer
        excludedLocationIds={new Set(['loc-canister'])}
        onMove={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Open Main pack packing options' }))

    expect(screen.queryByRole('button', { name: 'Bear canister' })).not.toBeInTheDocument()
  })
})
