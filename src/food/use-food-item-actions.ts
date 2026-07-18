import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  nextFoodItemSortOrder,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
} from '../lib/queries'
import type { FoodItem } from '../lib/types'
import type { FoodPatch } from './FoodItemDialog'

// Food-item write actions for FoodLibraryPage: add / edit / delete plus
// their optimistic wiring.
//
// Unlike gear, food uses the GENERIC single-cache optimistic helpers, not a
// fan-out: food is never a list_items row (design 4), so ['food-items'] is
// the only cache that gets an OPTIMISTIC write - owner-side projections
// derive from it and self-heal for free. Design 5.5 is explicit: do not
// build a gear-style multi-cache fan-out here.
//
// One side cache is invalidated on settle since slice 5: the public share
// (['shared-list']) carries a SERVER-computed food weight, which an edited
// serving weight or a delete (its plan entries cascade away) makes stale in
// a way no client derivation can heal (design 5.5). Edit and delete only -
// a freshly created food is referenced by no plan, so it cannot move any
// share's number.
//
// Error surfacing: create and edit roll back SILENTLY (no errorToast) - the
// page reads the mutation error and renders it inline in the open dialog
// (e.g. the cap 422). Delete uses an errorToast because its rollback (a row
// reappearing) is otherwise invisible and no dialog is open to host the
// message.
//
// `allItems` seeds the optimistic insert placeholder's sort slot; the server
// assigns the real max+1 and the settled refetch reconciles any race.
export function useFoodItemActions(allItems: FoodItem[]) {
  const qc = useQueryClient()

  const addItem = useMutation({
    mutationFn: (data: FoodPatch) => createFoodItem(data),
    ...makeOptimisticInsert<FoodItem, FoodPatch>({
      qc,
      queryKey: queryKeys.foodItems(),
      optimistic: (data) => {
        const now = new Date().toISOString()
        return {
          id: `temp-${crypto.randomUUID()}`,
          name: data.name,
          brand: data.brand,
          servingDescription: data.servingDescription,
          servingWeightGrams: data.servingWeightGrams,
          caloriesPerServing: data.caloriesPerServing,
          servingsPerPackage: data.servingsPerPackage,
          fatGrams: data.fatGrams,
          saturatedFatGrams: data.saturatedFatGrams,
          carbsGrams: data.carbsGrams,
          fiberGrams: data.fiberGrams,
          sugarGrams: data.sugarGrams,
          proteinGrams: data.proteinGrams,
          sodiumMg: data.sodiumMg,
          potassiumMg: data.potassiumMg,
          notes: data.notes,
          sortOrder: nextFoodItemSortOrder(allItems),
          createdAt: now,
          updatedAt: now,
        }
      },
    }),
  })

  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FoodPatch }) =>
      updateFoodItem(id, patch),
    ...makeOptimisticUpdate<FoodItem, { id: string; patch: FoodPatch }>({
      qc,
      queryKey: queryKeys.foodItems(),
      invalidateKeys: [queryKeys.sharedListAll()],
      id: ({ id }) => id,
      apply: (item, { patch }) => ({ ...item, ...patch }),
    }),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => deleteFoodItem(id),
    ...makeOptimisticDelete<FoodItem, string>({
      qc,
      queryKey: queryKeys.foodItems(),
      invalidateKeys: [queryKeys.sharedListAll()],
      id: (id) => id,
      errorToast: "Couldn't delete the food. Please try again.",
    }),
  })

  return { addItem, editItem, removeItem }
}
