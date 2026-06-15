// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { mutationErrorHandler } from '../lib/mutation-error-handler'
import type { Category, GearItem, List, PublicCategory, PublicList, PublicListItem } from '../lib/types'
import { usePublicGearCopyMutation } from './use-public-gear-copy-mutation'

const q = vi.hoisted(() => ({
  fetchLists: vi.fn(),
  fetchGearItems: vi.fn(),
  fetchCategories: vi.fn(),
  importListFromCsv: vi.fn(),
  nextListSortOrder: vi.fn(() => 9),
}))
const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('react-router', () => ({ useNavigate: () => navigateSpy }))
vi.mock('../lib/queries', () => ({
  queryKeys: {
    lists: () => ['lists'],
    gearItems: () => ['gear-items'],
    categories: () => ['categories'],
  },
  fetchLists: q.fetchLists,
  fetchGearItems: q.fetchGearItems,
  fetchCategories: q.fetchCategories,
  importListFromCsv: q.importListFromCsv,
  nextListSortOrder: q.nextListSortOrder,
}))

const PUBLIC_LIST: PublicList = {
  id: 'public-list',
  name: 'Wind River',
  description: null,
  group_worn: false,
  is_draft: false,
}

const COPIED_LIST: List = {
  id: 'new-list',
  user_id: 'u1',
  name: 'Wind River (copy)',
  description: null,
  slug: 'new123',
  is_shared: false,
  sort_order: 9,
  group_worn: false,
  ready_checks_enabled: false,
  is_draft: true,
  created_at: '',
  updated_at: '',
}

const PRIVATE_GEAR: GearItem = {
  id: 'gear-private',
  user_id: 'u1',
  category_id: 'cat-private',
  name: 'Tent',
  description: null,
  weight_grams: 1200,
  cost: null,
  purchase_date: null,
  status: 'active',
  sort_order: 0,
  created_at: '',
  updated_at: '',
}

const PRIVATE_CATEGORY: Category = {
  id: 'cat-private',
  user_id: 'u1',
  name: 'Shelter',
  sort_order: 0,
  is_default: false,
  created_at: '',
}

const PUBLIC_CATEGORY: PublicCategory = {
  id: 'cat-public',
  name: 'Shelter',
  sort_order: 0,
}

const PUBLIC_ITEM: PublicListItem = {
  id: 'item-public',
  gear_item_id: 'gear-public',
  quantity: 2,
  is_worn: true,
  is_consumable: false,
  sort_order: 0,
  gear_item: {
    id: 'gear-public',
    name: 'Tent',
    description: 'Shared tent',
    weight_grams: 1200,
    category_id: 'cat-public',
  },
}

let lastQc: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    mutationCache: new MutationCache({ onError: mutationErrorHandler }),
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  lastQc = qc
  return createElement(QueryClientProvider, { client: qc }, children)
}

describe('usePublicGearCopyMutation', () => {
  beforeEach(() => {
    q.fetchLists.mockReset().mockResolvedValue([])
    q.fetchGearItems.mockReset().mockResolvedValue([PRIVATE_GEAR])
    q.fetchCategories.mockReset().mockResolvedValue([PRIVATE_CATEGORY])
    q.importListFromCsv.mockReset().mockResolvedValue(COPIED_LIST)
    q.nextListSortOrder.mockClear().mockReturnValue(9)
    navigateSpy.mockClear()
  })

  afterEach(() => cleanup())

  it('copies a public gear list through the atomic list-import path', async () => {
    const { result } = renderHook(() => usePublicGearCopyMutation('u1'), { wrapper })
    const invalidateSpy = vi.spyOn(lastQc, 'invalidateQueries')

    act(() => {
      result.current.mutate({
        list: PUBLIC_LIST,
        items: [PUBLIC_ITEM],
        categories: [PUBLIC_CATEGORY],
      })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(q.fetchLists).toHaveBeenCalledWith('u1')
    expect(q.fetchGearItems).toHaveBeenCalledWith('u1')
    expect(q.fetchCategories).toHaveBeenCalledWith('u1')
    expect(q.importListFromCsv).toHaveBeenCalledWith(
      'u1',
      'Wind River (copy)',
      [{
        name: 'Tent',
        description: 'Shared tent',
        weight_grams: 1200,
        category: 'Shelter',
        quantity: 2,
        is_worn: true,
        is_consumable: false,
      }],
      [PRIVATE_GEAR],
      [PRIVATE_CATEGORY],
      9,
    )
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['lists'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['gear-items'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['categories'] })
    expect(navigateSpy).toHaveBeenCalledWith('/lists/new-list')
  })

  it('surfaces import failures and does not navigate', async () => {
    q.importListFromCsv.mockRejectedValueOnce(new Error('over cap'))
    const { result } = renderHook(() => usePublicGearCopyMutation('u1'), { wrapper })

    act(() => {
      result.current.mutate(
        { list: PUBLIC_LIST, items: [PUBLIC_ITEM], categories: [PUBLIC_CATEGORY] },
        { onError: () => {} },
      )
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(navigateSpy).not.toHaveBeenCalled()
  })
})
