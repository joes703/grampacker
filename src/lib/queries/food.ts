import { apiFetch, apiFetchVoid } from '../api'
import {
  foodItemResponseSchema,
  listFoodResponseSchema,
  type CreateFoodItemRequest,
  type FoodItemResponse,
  type ListFoodResponse,
  type UpdateFoodItemRequest,
} from '../../../shared/food'

// The food estimate for one list. Slots are the trip's eating periods, items
// are what you carry, and an item's slotIds say when you intend to eat it -
// never how much of it there is.

export async function fetchListFood(listId: string): Promise<ListFoodResponse> {
  return apiFetch(`/lists/${listId}/food`, listFoodResponseSchema)
}

export async function setFoodDays(
  listId: string,
  days: number,
): Promise<ListFoodResponse> {
  return apiFetch(`/lists/${listId}/food/days`, listFoodResponseSchema, {
    method: 'PUT',
    body: { days },
  })
}

export async function createFoodItem(
  listId: string,
  body: CreateFoodItemRequest,
): Promise<FoodItemResponse> {
  return apiFetch(`/lists/${listId}/food/items`, foodItemResponseSchema, {
    method: 'POST',
    body,
  })
}

export async function updateFoodItem(
  listId: string,
  itemId: string,
  patch: UpdateFoodItemRequest,
): Promise<FoodItemResponse> {
  return apiFetch(`/lists/${listId}/food/items/${itemId}`, foodItemResponseSchema, {
    method: 'PATCH',
    body: patch,
  })
}

export async function deleteFoodItem(listId: string, itemId: string): Promise<void> {
  await apiFetchVoid(`/lists/${listId}/food/items/${itemId}`, { method: 'DELETE' })
}
