import { describe, it, expect, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { fetchFoodPackSignatures, setFoodPackState, invalidateFoodPlanCaches } from './food-pack'

vi.mock('../supabase', () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [{ food_item_id: 'o', current_signature: '300|50' }], error: null }),
    from: vi.fn(),
  },
}))

describe('food-pack wrappers', () => {
  it('fetchFoodPackSignatures forwards user + list to the read RPC', async () => {
    const { supabase } = await import('../supabase')
    const rows = await fetchFoodPackSignatures('u1', 'l1')
    expect(supabase.rpc).toHaveBeenCalledWith('get_food_pack_signatures', { p_user_id: 'u1', p_list_id: 'l1' })
    expect(rows[0]).toEqual({ food_item_id: 'o', current_signature: '300|50' })
  })

  it('setFoodPackState forwards the toggle and expected signature', async () => {
    const { supabase } = await import('../supabase')
    ;(supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { is_packed: true }, error: null })
    await setFoodPackState('u1', 'l1', 'o', true, '300|50')
    expect(supabase.rpc).toHaveBeenCalledWith('set_food_pack_state',
      { p_user_id: 'u1', p_list_id: 'l1', p_food_item_id: 'o', p_is_packed: true, p_expected_signature: '300|50' })
  })

  it('invalidateFoodPlanCaches invalidates both food-plan and signatures', () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    invalidateFoodPlanCaches(qc, 'l1')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['food-plan', 'l1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['food-pack-signatures', 'l1'] })
  })
})
