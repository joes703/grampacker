import { afterEach, describe, expect, it, vi } from 'vitest'

// updateSpy captures the patch passed to from('lists').update(patch).eq('id', id).
// selectSpy/countEqSpy capture the head-count chain from fetchListCount, and
// countResult lets each test drive that chain's resolved { count, error }.
// vi.hoisted lets the (hoisted) vi.mock factory reference the spies safely.
const { updateSpy, selectSpy, countEqSpy, countResult } = vi.hoisted(() => ({
  updateSpy: vi.fn(),
  selectSpy: vi.fn(),
  countEqSpy: vi.fn(),
  countResult: { value: { count: 0 as number | null, error: null as { message: string } | null } },
}))

vi.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (patch: unknown) => {
        updateSpy(patch)
        return { eq: () => Promise.resolve({ error: null }) }
      },
      // head-count chain: .select('id', { count, head }).eq('user_id', uid)
      select: (columns: string, options?: unknown) => {
        selectSpy(table, columns, options)
        return {
          eq: (column: string, value: unknown) => {
            countEqSpy(column, value)
            return Promise.resolve(countResult.value)
          },
        }
      },
    }),
  },
}))

import { updateList, fetchListCount } from './lists'
import { queryKeys } from './keys'

afterEach(() => {
  updateSpy.mockClear()
  selectSpy.mockClear()
  countEqSpy.mockClear()
})

describe('updateList', () => {
  it('forwards is_draft in the update patch', async () => {
    await updateList('list-1', { is_draft: false })
    expect(updateSpy).toHaveBeenCalledWith({ is_draft: false })
  })
})

describe('fetchListCount', () => {
  it('requests a head-only exact count scoped to the owner and returns it', async () => {
    countResult.value = { count: 4, error: null }
    expect(await fetchListCount('user-1')).toBe(4)
    // head: true => no row payload; exact => a real count; user_id => owner scope.
    expect(selectSpy).toHaveBeenCalledWith('lists', 'id', { count: 'exact', head: true })
    expect(countEqSpy).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('returns 0 when supabase reports a null count', async () => {
    countResult.value = { count: null, error: null }
    expect(await fetchListCount('user-1')).toBe(0)
  })

  it('throws when supabase returns an error', async () => {
    countResult.value = { count: null, error: { message: 'boom' } }
    await expect(fetchListCount('user-1')).rejects.toBeDefined()
  })
})

describe('queryKeys.listCount invalidation contract', () => {
  // The count is never invalidated explicitly. It works only because its key is
  // a child of queryKeys.lists(), so every existing invalidateQueries(['lists'])
  // on a list create/delete cascades to it via TanStack prefix matching. If this
  // relationship breaks, the gear-page list count silently goes stale.
  it('is a child of queryKeys.lists so list invalidations cascade to the count', () => {
    const parent = queryKeys.lists()
    const child = queryKeys.listCount()
    expect(child.slice(0, parent.length)).toEqual(parent)
    expect(child).not.toEqual(parent)
  })
})
