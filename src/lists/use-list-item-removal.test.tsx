// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ListItemWithGear } from '../lib/types'

const h = vi.hoisted(() => ({
  queryKeys: {
    listItems: (id: string) => ['list-items', id] as const,
    packingLocations: (id: string) => ['packing-locations', id] as const,
  },
  addListItem: vi.fn<(listId: string, gearItemId: string) => Promise<{ id: string }>>(),
  updateListItem: vi.fn<(listId: string, itemId: string, patch: unknown) => Promise<void>>(),
}))
const toast = vi.hoisted(() => ({
  showToast: vi.fn<(message: string, options?: {
    type?: string
    action?: { label: string; onAction: () => void }
  }) => number>(),
}))

vi.mock('../lib/queries', () => ({
  queryKeys: h.queryKeys,
  addListItem: h.addListItem,
  updateListItem: h.updateListItem,
}))
vi.mock('../lib/toast', () => ({ showToast: toast.showToast }))

import { useListItemRemoval } from './use-list-item-removal'

const LIST_ID = 'list-1'

function item(overrides: Partial<ListItemWithGear> = {}): ListItemWithGear {
  return {
    id: 'li-1',
    listId: LIST_ID,
    gearItemId: 'gear-1',
    quantity: 1,
    isWorn: false,
    isConsumable: false,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder: 0,
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    gearItem: {
      id: 'gear-1',
      categoryId: null,
      name: 'Tarp',
      description: null,
      weightGrams: 250,
      cost: null,
      purchaseDate: null,
      status: 'active',
      sortOrder: 0,
      createdAt: '2026-06-06T00:00:00.000Z',
      updatedAt: '2026-06-06T00:00:00.000Z',
    },
    ...overrides,
  }
}

// Captures the delete callback the page would normally supply, so a test can
// decide whether the delete "succeeded" and when.
function setup() {
  const removed: string[] = []
  let confirmRemoval: (() => void) | null = null
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidated: unknown[] = []
  qc.invalidateQueries = vi.fn((filters?: { queryKey?: unknown }) => {
    invalidated.push(filters?.queryKey)
    return Promise.resolve()
  }) as unknown as QueryClient['invalidateQueries']

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () =>
      useListItemRemoval(LIST_ID, (itemId, onRemoved) => {
        removed.push(itemId)
        confirmRemoval = onRemoved
      }),
    { wrapper },
  )
  return {
    result,
    removed,
    invalidated,
    settleDelete: () => confirmRemoval?.(),
  }
}

function undoFromToast() {
  const call = toast.showToast.mock.calls.find(([, options]) => options?.action)
  call?.[1]?.action?.onAction()
}

beforeEach(() => {
  h.addListItem.mockResolvedValue({ id: 'li-new' })
  h.updateListItem.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useListItemRemoval', () => {
  it('removes immediately without any confirm', () => {
    const { result, removed } = setup()

    result.current.removeWithUndo(item())

    expect(removed).toEqual(['li-1'])
  })

  it('offers Undo only after the server confirms the delete', () => {
    // Offering to undo a removal that has not happened would be a lie, and a
    // failed delete has already snapped the optimistic row back.
    const { result, settleDelete } = setup()

    result.current.removeWithUndo(item())
    expect(toast.showToast).not.toHaveBeenCalled()

    settleDelete()
    expect(toast.showToast).toHaveBeenCalledWith(
      'Removed "Tarp"',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    )
  })

  it('re-adds the gear and restores its fields on undo', async () => {
    const { result, settleDelete } = setup()

    result.current.removeWithUndo(item({
      quantity: 3,
      isConsumable: true,
      isPacked: true,
      packingLocationId: 'loc-1',
    }))
    settleDelete()
    undoFromToast()

    await waitFor(() => expect(h.addListItem).toHaveBeenCalledWith(LIST_ID, 'gear-1'))
    // Patched against the id the server just minted, NOT the id that was
    // deleted - the restored row is a new row.
    await waitFor(() =>
      expect(h.updateListItem).toHaveBeenCalledWith(LIST_ID, 'li-new', {
        quantity: 3,
        isWorn: false,
        isConsumable: true,
        isPacked: true,
        isReady: false,
        packingLocationId: 'loc-1',
      }),
    )
  })

  it('skips the restore patch for a pristine row', async () => {
    // A freshly added, untouched item has nothing to restore; a second
    // request would write only defaults.
    const { result, settleDelete } = setup()

    result.current.removeWithUndo(item())
    settleDelete()
    undoFromToast()

    await waitFor(() => expect(h.addListItem).toHaveBeenCalled())
    expect(h.updateListItem).not.toHaveBeenCalled()
  })

  it('invalidates list items AND packing locations after an undo', async () => {
    // The restored row can carry a packingLocationId, and the delete that
    // preceded it may itself have cascaded a location away.
    const { result, settleDelete, invalidated } = setup()

    result.current.removeWithUndo(item())
    settleDelete()
    undoFromToast()

    await waitFor(() => expect(invalidated).toContainEqual(['list-items', LIST_ID]))
    expect(invalidated).toContainEqual(['packing-locations', LIST_ID])
  })

  it('reports a failed re-add without letting the rejection escape', async () => {
    // The gear was deleted from inventory, or another client refilled the
    // 300-item cap. Both are real, both must surface as feedback rather than
    // an unhandled rejection.
    h.addListItem.mockRejectedValue(new Error('gone'))
    const { result, settleDelete } = setup()

    result.current.removeWithUndo(item())
    settleDelete()
    undoFromToast()

    await waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith(
        'Couldn\'t put "Tarp" back. Try adding it again.',
        { type: 'error' },
      ),
    )
  })

  it('distinguishes a partial restore from a failed one', async () => {
    // The row IS back, just pristine. Reporting that as "couldn't put it
    // back" would send the user looking for a row that is on screen.
    h.updateListItem.mockRejectedValue(new Error('nope'))
    const { result, settleDelete } = setup()

    result.current.removeWithUndo(item({ quantity: 4 }))
    settleDelete()
    undoFromToast()

    await waitFor(() =>
      expect(toast.showToast).toHaveBeenCalledWith(
        '"Tarp" is back, but its quantity and flags couldn\'t be restored.',
        { type: 'error' },
      ),
    )
  })

  it('restores two overlapping removals independently', async () => {
    // Regression: a single hook-wide in-flight boolean used to guard this.
    // Remove two items, undo the first, then undo the second while the first
    // request is still pending, and the second Undo was silently discarded -
    // the toast had already dismissed itself, so the click looked handled and
    // the item stayed deleted. Independent removals are independent restores.
    const { result, settleDelete } = setup()

    result.current.removeWithUndo(item({ id: 'li-1', gearItemId: 'gear-1' }))
    settleDelete()
    result.current.removeWithUndo(item({ id: 'li-2', gearItemId: 'gear-2' }))
    settleDelete()

    for (const call of toast.showToast.mock.calls) {
      call[1]?.action?.onAction()
    }

    await waitFor(() => expect(h.addListItem).toHaveBeenCalledTimes(2))
    expect(h.addListItem).toHaveBeenCalledWith(LIST_ID, 'gear-1')
    expect(h.addListItem).toHaveBeenCalledWith(LIST_ID, 'gear-2')
  })
})
