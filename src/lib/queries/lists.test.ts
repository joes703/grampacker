import { afterEach, describe, expect, it, vi } from 'vitest'

// Capture the patch passed to supabase.from('lists').update(patch).eq('id', id).
// vi.hoisted lets the (hoisted) vi.mock factory reference the spy safely.
const { updateSpy } = vi.hoisted(() => ({ updateSpy: vi.fn() }))

vi.mock('../supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: unknown) => {
        updateSpy(patch)
        return { eq: () => Promise.resolve({ error: null }) }
      },
    }),
  },
}))

import { updateList } from './lists'

afterEach(() => {
  updateSpy.mockClear()
})

describe('updateList', () => {
  it('forwards is_draft in the update patch', async () => {
    await updateList('list-1', { is_draft: false })
    expect(updateSpy).toHaveBeenCalledWith({ is_draft: false })
  })
})
