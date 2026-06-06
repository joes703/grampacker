// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { createElement, type ReactNode } from 'react'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import { useCurrentListActions } from './use-current-list-actions'
import { showToast } from '../lib/toast'
import { duplicateList } from '../lib/queries'
import type { List } from '../lib/types'

vi.mock('../lib/toast', () => ({ showToast: vi.fn() }))
vi.mock('../lib/queries', async (orig) => ({
  ...(await orig<typeof import('../lib/queries')>()),
  duplicateList: vi.fn(),
  fetchListItems: vi.fn(),
  fetchCategories: vi.fn(),
}))
vi.mock('../lib/csv', () => ({ listItemsToCsv: vi.fn(() => 'csv'), downloadCsv: vi.fn() }))

const LIST: List = {
  id: 'l1',
  user_id: 'u1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  is_shared: false,
  is_draft: false,
  group_worn: false,
  ready_checks_enabled: false,
  sort_order: 0,
  created_at: '',
  updated_at: '',
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, children))
}

describe('useCurrentListActions - duplicate failure feedback', () => {
  beforeEach(() => { vi.mocked(showToast).mockClear() })
  afterEach(() => cleanup())

  it('toasts when duplicateList rejects', async () => {
    vi.mocked(duplicateList).mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    act(() => { result.current.duplicateMut.mutate(LIST) })
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("Couldn't duplicate that list. Please try again.", { type: 'error' }),
    )
  })
})

describe('useCurrentListActions - exportCsv failure feedback', () => {
  beforeEach(() => { vi.mocked(showToast).mockClear() })
  afterEach(() => cleanup())

  it('toasts and does not download when the fetch rejects', async () => {
    const { fetchListItems } = await import('../lib/queries')
    const { downloadCsv } = await import('../lib/csv')
    vi.mocked(fetchListItems).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useCurrentListActions('u1'), { wrapper })
    await act(async () => { await result.current.exportCsv(LIST) })
    expect(showToast).toHaveBeenCalledWith("Couldn't export the list. Please try again.", { type: 'error' })
    expect(downloadCsv).not.toHaveBeenCalled()
  })
})
