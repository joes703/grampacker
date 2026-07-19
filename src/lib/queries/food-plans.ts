import {
  foodPlanDocumentSchema,
  foodPlanSummarySchema,
  type AddEntryRequestInput,
  type CreateFoodPlanRequestInput,
  type FoodPlanDocument,
  type FoodPlanSummary,
  type UpdateEntryRequest,
} from '../../../shared/food-plans'
import { apiFetch, apiFetchVoid } from '../api'

// The SPA-side food-plan types ARE the shared DTOs (same rationale as food.ts).
export type { FoodPlanDocument, FoodPlanSummary }

// The index list. Cheap aggregates only (day/entry counts); the full graph
// loads per plan.
export async function fetchFoodPlans(): Promise<FoodPlanSummary[]> {
  return apiFetch('/food-plans', foodPlanSummarySchema.array())
}

export async function fetchFoodPlan(id: string): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}`, foodPlanDocumentSchema)
}

// Every mutation below (except deleteFoodPlan) returns the FRESH plan document
// from one batched server read, so the caller writes it straight into the
// ['food-plan', id] cache - no fine-grained optimistic reconstruction of the
// graph on the client (design 5.5). deleteFoodPlan alone is 204.

export async function createFoodPlan(
  input: CreateFoodPlanRequestInput,
): Promise<FoodPlanDocument> {
  return apiFetch('/food-plans', foodPlanDocumentSchema, {
    method: 'POST',
    body: input,
  })
}

export async function renameFoodPlan(
  id: string,
  name: string,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}`, foodPlanDocumentSchema, {
    method: 'PATCH',
    body: { name },
  })
}

export async function deleteFoodPlan(id: string): Promise<void> {
  await apiFetchVoid(`/food-plans/${id}`, { method: 'DELETE' })
}

// Deep copy (design 3.1). listId = "Duplicate & attach": the server attaches
// the copy to that list in the same transaction as the copy. Returns the NEW
// plan's document.
// expectedFoodPlanId: the link the caller OBSERVED on listId (null = none) -
// the server's attach is a compare-and-swap on it (shared/food-plans.ts).
// Meaningful only when listId is set.
export async function duplicateFoodPlan(
  id: string,
  listId: string | null,
  expectedFoodPlanId: string | null,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/duplicate`, foodPlanDocumentSchema, {
    method: 'POST',
    body: { listId, expectedFoodPlanId },
  })
}

export async function addFoodPlanDay(id: string): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/days`, foodPlanDocumentSchema, {
    method: 'POST',
  })
}

export async function removeFoodPlanDay(
  id: string,
  dayId: string,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/days/${dayId}`, foodPlanDocumentSchema, {
    method: 'DELETE',
  })
}

export async function addFoodPlanMeal(
  id: string,
  name: string,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/meals`, foodPlanDocumentSchema, {
    method: 'POST',
    body: { name },
  })
}

export async function removeFoodPlanMeal(
  id: string,
  mealId: string,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/meals/${mealId}`, foodPlanDocumentSchema, {
    method: 'DELETE',
  })
}

export async function addFoodPlanDayMeal(
  id: string,
  dayId: string,
  mealId: string,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/day-meals`, foodPlanDocumentSchema, {
    method: 'POST',
    body: { dayId, mealId },
  })
}

export async function removeFoodPlanDayMeal(
  id: string,
  dayMealId: string,
): Promise<FoodPlanDocument> {
  return apiFetch(
    `/food-plans/${id}/day-meals/${dayMealId}`,
    foodPlanDocumentSchema,
    { method: 'DELETE' },
  )
}

// Force a day full/partial for target grading; null returns it to auto
// (derived from whether every anchor meal is scheduled - design 14.5).
export async function setFoodPlanDayType(
  id: string,
  dayId: string,
  dayTypeOverride: 'full' | 'partial' | null,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/days/${dayId}`, foodPlanDocumentSchema, {
    method: 'PATCH',
    body: { dayTypeOverride },
  })
}

export async function addFoodPlanEntry(
  id: string,
  input: AddEntryRequestInput,
): Promise<FoodPlanDocument> {
  return apiFetch(`/food-plans/${id}/entries`, foodPlanDocumentSchema, {
    method: 'POST',
    body: input,
  })
}

export async function updateFoodPlanEntry(
  id: string,
  entryId: string,
  patch: UpdateEntryRequest,
): Promise<FoodPlanDocument> {
  return apiFetch(
    `/food-plans/${id}/entries/${entryId}`,
    foodPlanDocumentSchema,
    { method: 'PATCH', body: patch },
  )
}

export async function removeFoodPlanEntry(
  id: string,
  entryId: string,
): Promise<FoodPlanDocument> {
  return apiFetch(
    `/food-plans/${id}/entries/${entryId}`,
    foodPlanDocumentSchema,
    { method: 'DELETE' },
  )
}
