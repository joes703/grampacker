import {
  foodItemResponseSchema,
  type CreateFoodItemRequestInput,
  type FoodItemResponse,
  type UpdateFoodItemRequest,
} from '../../../shared/food'
import { apiFetch, apiFetchVoid } from '../api'

// The SPA-side food type IS the shared DTO (see gear.ts / categories.ts for
// the camelCase rationale). One source of truth, camelCase end to end.
export type FoodItem = FoodItemResponse

export async function fetchFoodItems(): Promise<FoodItem[]> {
  return apiFetch('/food-items', foodItemResponseSchema.array())
}

export async function createFoodItem(
  input: CreateFoodItemRequestInput,
): Promise<FoodItem> {
  return apiFetch('/food-items', foodItemResponseSchema, {
    method: 'POST',
    body: input,
  })
}

// PATCH semantics: absent = unchanged, null = clear (nullable fields).
export async function updateFoodItem(
  id: string,
  patch: UpdateFoodItemRequest,
): Promise<FoodItem> {
  return apiFetch(`/food-items/${id}`, foodItemResponseSchema, {
    method: 'PATCH',
    body: patch,
  })
}

export async function deleteFoodItem(id: string): Promise<void> {
  await apiFetchVoid(`/food-items/${id}`, { method: 'DELETE' })
}

// The server assigns the real sortOrder on create (max+1); the optimistic
// placeholder computes the same value against the cached rows so it lands
// where the server row will (the settled refetch reconciles any race).
export function nextFoodItemSortOrder(items: FoodItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.sortOrder), -1) + 1
}
