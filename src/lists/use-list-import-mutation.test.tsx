// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import type { Category, GearItem } from '../lib/types'
import type { ListCsvRow } from '../lib/csv'
import { queryKeys } from '../lib/queries/keys'
import { unconfirmedId } from '../lib/unconfirmed-id'

const api = vi.hoisted(() => ({ importListFromCsv: vi.fn() }))
vi.mock('../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/queries')>()),
  importListFromCsv: api.importListFromCsv,
}))

import { useListImportMutation } from './use-list-import-mutation'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const pendingCategory: Category = {
  id: unconfirmedId(),
  name: 'Kitchen',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
}
const pendingGear: GearItem = {
  id: unconfirmedId(),
  categoryId: pendingCategory.id,
  name: 'Stove',
  description: null,
  weightGrams: 80,
  cost: null,
  purchaseDate: null,
  status: 'active',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
const row: ListCsvRow = {
  name: 'Stove',
  description: null,
  weightGrams: 80,
  categoryName: 'Kitchen',
  quantity: 1,
  isWorn: false,
  isConsumable: false,
  cost: null,
}

// A gear item or category whose create is still pending is in the caches the
// import plans against. Matching a CSV row to it would put its unconfirmed id
// in the request, and the server's ownership check rejects the whole import.
describe('useListImportMutation while a create is pending', () => {
  it('plans against confirmed rows only, so no unconfirmed id is sent', async () => {
    // Fresh within the app's staleTime, as the caches are in the app: the
    // hook's fetchQuery then reads them instead of refetching.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
    })
    qc.setQueryData(queryKeys.gearItems(), [pendingGear])
    qc.setQueryData(queryKeys.categories(), [pendingCategory])
    api.importListFromCsv.mockResolvedValue({ id: 'new-list' })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, children))
    const { result } = renderHook(() => useListImportMutation(), { wrapper })

    act(() => { result.current.mutate({ name: 'Trip', rows: [row] }) })

    await waitFor(() => expect(api.importListFromCsv).toHaveBeenCalledTimes(1))
    expect(JSON.stringify(api.importListFromCsv.mock.calls[0]?.[0])).not.toContain('temp-')
  })
})
