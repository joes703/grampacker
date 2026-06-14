import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchFoodItems,
  fetchFoodPackSignatures,
  fetchFoodPackState,
  fetchFoodPlan,
  invalidateFoodPlanCaches,
  queryKeys,
  setFoodPackState,
  type FoodPackStateRow,
} from '../lib/queries'
import { projectFoodPlan, totalProjectedConsumableGrams } from '../lib/food/projection'
import { showToast } from '../lib/toast'
import type { FoodItem } from '../lib/types'
import type { FoodProjectionDisplayRow } from './FoodProjectionSection'

type ToggleVars = { foodItemId: string; next: boolean }
type ToggleContext = { previous: FoodPackStateRow[] | undefined }

function formatServings(n: number): string {
  const rounded = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')
  return `${rounded} serving${rounded === '1' ? '' : 's'}`
}

function errorMessage(code: unknown): string {
  switch (code) {
    case 'PT409': return "This food's quantity changed. We refreshed it - check the new amount and pack again."
    case '22023': return 'This food is missing packaging info. Fix it in the Food plan to pack it.'
    case '23503': return 'This food is no longer in the plan.'
    case 'P0002': return 'Food plan not found - it may have been deleted.'
    default: return "Couldn't update packing. Please try again."
  }
}

export function useFoodProjection(userId: string, listId: string) {
  const qc = useQueryClient()
  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(listId),
    queryFn: () => fetchFoodPlan(userId, listId),
  })
  const hasPlan = Boolean(planQuery.data)
  const foodsQuery = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: () => fetchFoodItems(userId),
    enabled: hasPlan,
  })
  const signaturesQuery = useQuery({
    queryKey: queryKeys.foodPackSignatures(listId),
    queryFn: () => fetchFoodPackSignatures(userId, listId),
    enabled: hasPlan,
  })
  const packStateQuery = useQuery({
    queryKey: queryKeys.foodPackState(listId),
    queryFn: () => fetchFoodPackState(userId, listId),
    enabled: hasPlan,
  })

  const foodById = useMemo(
    () => new Map<string, FoodItem>((foodsQuery.data ?? []).map((f) => [f.id, f])),
    [foodsQuery.data],
  )
  const signaturesByFood = useMemo(
    () => new Map((signaturesQuery.data ?? []).map((s) => [s.food_item_id, s.current_signature])),
    [signaturesQuery.data],
  )
  const packByFood = useMemo(
    () => new Map((packStateQuery.data ?? []).map((s) => [s.food_item_id, s])),
    [packStateQuery.data],
  )

  const projectionRows = useMemo(() => {
    if (!planQuery.data) return []
    return projectFoodPlan(planQuery.data.entries, foodById)
  }, [foodById, planQuery.data])

  const rows = useMemo<FoodProjectionDisplayRow[]>(() => projectionRows.map((row) => {
    const food = row.food
    const name = food?.name ?? 'Unknown food'
    const brand = food?.brand ?? null
    if (row.state === 'incomplete') {
      return { foodItemId: row.foodItemId, state: 'incomplete', name, brand, reason: row.reason }
    }
    const currentSignature = signaturesByFood.get(row.foodItemId) ?? null
    const packRow = packByFood.get(row.foodItemId)
    const packed = Boolean(
      currentSignature &&
      packRow?.is_packed === true &&
      packRow.packed_signature === currentSignature,
    )
    return {
      foodItemId: row.foodItemId,
      state: 'complete',
      name,
      brand,
      servingsLabel: formatServings(row.totalEffectiveServings),
      weightGrams: row.totalPackedWeightGrams,
      packed,
      packable: currentSignature !== null,
    }
  }), [packByFood, projectionRows, signaturesByFood])

  const togglePacked = useMutation<FoodPackStateRow, unknown, ToggleVars, ToggleContext>({
    mutationFn: ({ foodItemId, next }) => {
      const expectedSignature = next ? (signaturesByFood.get(foodItemId) ?? null) : null
      if (next && expectedSignature === null) {
        const err = new Error('Food is not packable') as Error & { code: string }
        err.code = '22023'
        throw err
      }
      return setFoodPackState(userId, listId, foodItemId, next, expectedSignature)
    },
    onMutate: async ({ foodItemId, next }) => {
      const key = queryKeys.foodPackState(listId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<FoodPackStateRow[]>(key)
      const signature = next ? (signaturesByFood.get(foodItemId) ?? '') : ''
      qc.setQueryData<FoodPackStateRow[]>(key, (curr = []) => {
        const row = { food_item_id: foodItemId, is_packed: next, packed_signature: signature }
        return curr.some((r) => r.food_item_id === foodItemId)
          ? curr.map((r) => (r.food_item_id === foodItemId ? row : r))
          : [...curr, row]
      })
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      qc.setQueryData(queryKeys.foodPackState(listId), ctx?.previous)
      invalidateFoodPlanCaches(qc, listId)
      qc.invalidateQueries({ queryKey: queryKeys.foodPackState(listId) })
      showToast(errorMessage((err as { code?: unknown } | null)?.code), { type: 'error' })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKeys.foodPackState(listId) })
    },
  })

  async function resetPackedFoods() {
    const packedRows = rows.filter((r) => r.state === 'complete' && r.packed)
    if (packedRows.length === 0) return
    const key = queryKeys.foodPackState(listId)
    await qc.cancelQueries({ queryKey: key })
    const previous = qc.getQueryData<FoodPackStateRow[]>(key)
    qc.setQueryData<FoodPackStateRow[]>(key, (curr = []) =>
      curr.map((row) => (
        packedRows.some((r) => r.foodItemId === row.food_item_id)
          ? { ...row, is_packed: false, packed_signature: '' }
          : row
      )),
    )
    try {
      await Promise.all(packedRows.map((row) => setFoodPackState(userId, listId, row.foodItemId, false, null)))
    } catch {
      qc.setQueryData(key, previous)
      showToast("Couldn't reset packed food. Please try again.", { type: 'error' })
    } finally {
      qc.invalidateQueries({ queryKey: key })
    }
  }

  return {
    rows,
    projectedConsumableGrams: totalProjectedConsumableGrams(projectionRows),
    hasIncompleteRows: projectionRows.some((r) => r.state === 'incomplete'),
    packableTotal: rows.filter((r) => r.state === 'complete').length,
    packedTotal: rows.filter((r) => r.state === 'complete' && r.packed).length,
    hasPlan,
    isLoading: planQuery.isLoading || foodsQuery.isLoading || (hasPlan && (signaturesQuery.isLoading || packStateQuery.isLoading)),
    isError: planQuery.isError || foodsQuery.isError || signaturesQuery.isError || packStateQuery.isError,
    togglePacked: (foodItemId: string, next: boolean) => togglePacked.mutate({ foodItemId, next }),
    resetPackedFoods,
  }
}
