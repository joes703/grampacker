import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks referenced inside vi.mock MUST be hoisted (the factory is hoisted above
// plain consts). Matches the vi.hoisted idiom in food-plan.test.ts.
const h = vi.hoisted(() => {
  const eq = vi.fn()
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn()
  return { eq, select, from, rpc }
})
vi.mock('../supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }))
import { fetchTargetDefaults, saveTargetDefaults } from './target-defaults'

// clearAllMocks resets call history but KEEPS the from/select implementations
// (those are set via the vi.fn factory arg, which clear does not remove).
beforeEach(() => { vi.clearAllMocks() })

describe('fetchTargetDefaults', () => {
  it('selects defaults scoped to the user', async () => {
    h.eq.mockResolvedValueOnce({ data: [], error: null })
    await fetchTargetDefaults('u1')
    expect(h.from).toHaveBeenCalledWith('food_plan_target_defaults')
    expect(h.eq).toHaveBeenCalledWith('user_id', 'u1')
  })
  it('throws on error', async () => {
    h.eq.mockResolvedValueOnce({ data: null, error: new Error('boom') })
    await expect(fetchTargetDefaults('u1')).rejects.toThrow('boom')
  })
})

describe('saveTargetDefaults', () => {
  it('calls the RPC with the payload', async () => {
    h.rpc.mockResolvedValueOnce({ error: null })
    await saveTargetDefaults('u1', { upserts: [{ metric: 'calories', mode: 'max', target_min: null, target_max: 2500 }], deletes: ['protein'] })
    expect(h.rpc).toHaveBeenCalledWith('save_target_defaults', {
      p_user_id: 'u1',
      p_upserts: [{ metric: 'calories', mode: 'max', target_min: null, target_max: 2500 }],
      p_deletes: ['protein'],
    })
  })
  it('throws on RPC error', async () => {
    h.rpc.mockResolvedValueOnce({ error: new Error('nope') })
    await expect(saveTargetDefaults('u1', { upserts: [], deletes: [] })).rejects.toThrow('nope')
  })
})
