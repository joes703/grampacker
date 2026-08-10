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
    const max = /width\s*<\s*([\d.]+)rem/.exec(query)?.[1]
    return {
      // Queries are rem (Tailwind's own unit); *16 converts to the px
      // widths these tests pass. Strict, matching use-breakpoint.ts: at
      // exactly 64rem the query is false and Tailwind's `lg:` takes over.
      matches: max !== undefined && width < Number(max) * 16,
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

// Pack could previously only rearrange what was already on the list. Noticing
// "I am not taking this" while packing meant leaving for List view and finding
// the row again.
describe('MoveToLocationMenu removal', () => {
  it.each([390, 1440])('offers removal and invokes it at %ipx', async (width) => {
    stubViewport(width)
    const user = userEvent.setup()
    const onRemoveFromList = vi.fn()
    render(
      <MoveToLocationMenu
        itemId="item-pot"
        itemName="Cooking pot"
        currentLocationId={null}
        locations={locations}
        mobile={width < 1024}
        disabled={false}
        containerCreationDisabled={false}
        isContainer={false}
        onMove={vi.fn()}
        onUseAsContainer={vi.fn()}
        onRemoveFromList={onRemoveFromList}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Open Cooking pot packing options' }))
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))

    expect(onRemoveFromList).toHaveBeenCalledTimes(1)
  })

  // A container's own row carries it too: removing it destroys the location
  // and drops its contents to Unassigned, which the page confirms first.
  it('offers removal on a container row', async () => {
    stubViewport(1440)
    const user = userEvent.setup()
    const onRemoveFromList = vi.fn()
    render(
      <MoveToLocationMenu
        itemId="item-canister"
        itemName="Bear canister"
        currentLocationId={null}
        locations={locations}
        mobile={false}
        disabled={false}
        containerCreationDisabled={false}
        isContainer
        onMove={vi.fn()}
        onRemoveFromList={onRemoveFromList}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Open Bear canister packing options' }))
    await user.click(screen.getByRole('button', { name: 'Remove from list' }))

    expect(onRemoveFromList).toHaveBeenCalledTimes(1)
  })

  // The prop is optional, and the caller that omits it must not get a dead or
  // silently-inert menu entry.
  it('omits removal entirely when no handler is supplied', async () => {
    stubViewport(1440)
    const user = userEvent.setup()
    render(<MenuHarness onUseAsContainer={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Open Cooking pot packing options' }))

    expect(screen.queryByRole('button', { name: 'Remove from list' })).not.toBeInTheDocument()
  })

  it('does not fire removal while the menu is disabled', async () => {
    stubViewport(1440)
    const user = userEvent.setup()
    const onRemoveFromList = vi.fn()
    render(
      <MoveToLocationMenu
        itemId="item-pot"
        itemName="Cooking pot"
        currentLocationId={null}
        locations={locations}
        mobile={false}
        disabled
        containerCreationDisabled={false}
        isContainer={false}
        onMove={vi.fn()}
        onUseAsContainer={vi.fn()}
        onRemoveFromList={onRemoveFromList}
      />,
    )

    // The kebab itself is disabled while a packing write is in flight, so the
    // menu never opens and removal is unreachable.
    const kebab = screen.getByRole('button', { name: 'Open Cooking pot packing options' })
    expect((kebab as HTMLButtonElement).disabled).toBe(true)
    await user.click(kebab)
    expect(screen.queryByRole('button', { name: 'Remove from list' })).not.toBeInTheDocument()
    expect(onRemoveFromList).not.toHaveBeenCalled()
  })
})
