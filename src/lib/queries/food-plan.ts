import { publicSupabase, supabase } from '../supabase'
import { randomTempId } from '../random-temp-id'
import { FOOD_PLAN_DAY_CAP, MEAL_DEFINITION_CAP, FOOD_PLAN_ENTRY_CAP } from '../caps'
import type { FoodPlanStructure } from '../food/basis'
import type {
  FoodPlan, Meal, FoodPlanDay, DayMeal, FoodPlanEntry, FoodPlanDocument, EntryBasis,
  FoodPlanDailyTarget, MealTarget, DailyTargetInput, MealTargetInput,
  DailyTargetMetric, MealTargetMetric, TargetMode, PublicFoodProjection,
} from '../types'

// ---- Public aggregate projection (shared Gear list, no auth).
type PublicFoodProjectionViewRow = PublicFoodProjection

const FORBIDDEN_PUBLIC_FOOD_PROJECTION_KEYS: readonly string[] = [
  'id',
  'user_id',
  'list_id',
  'food_plan_id',
  'food_item_id',
  'day_meal_id',
  'is_extra',
  'notes',
  'calories_per_serving',
  'protein_grams',
  'sodium_mg',
  'is_food_shared',
  'created_at',
  'updated_at',
  'is_packed',
  'packed_signature',
]

function publicFoodProjectionShapeError(index: number, field: string, expected: string): Error {
  return new Error(`Unexpected public food projection response shape: row ${index} field "${field}" is not ${expected}`)
}

function assertPublicFoodProjectionRows(data: unknown): asserts data is PublicFoodProjectionViewRow[] {
  if (!Array.isArray(data)) {
    throw new Error('Unexpected public food projection response shape: payload is not an array')
  }
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    if (!row || typeof row !== 'object') {
      throw new Error(`Unexpected public food projection response shape: row ${i} is not an object`)
    }
    const r = row as Record<string, unknown>
    for (const key of FORBIDDEN_PUBLIC_FOOD_PROJECTION_KEYS) {
      if (key in r) {
        throw new Error(`Unexpected public food projection response shape: row ${i} carries forbidden key "${key}"`)
      }
    }
    if (typeof r.list_slug !== 'string') throw publicFoodProjectionShapeError(i, 'list_slug', 'string')
    if (typeof r.food_name !== 'string') throw publicFoodProjectionShapeError(i, 'food_name', 'string')
    if (r.brand !== null && typeof r.brand !== 'string') throw publicFoodProjectionShapeError(i, 'brand', 'string or null')
    if (typeof r.total_effective_servings !== 'number') {
      throw publicFoodProjectionShapeError(i, 'total_effective_servings', 'number')
    }
    if (typeof r.total_weight_grams !== 'number') {
      throw publicFoodProjectionShapeError(i, 'total_weight_grams', 'number')
    }
  }
}

export async function fetchSharedFoodProjection(slug: string): Promise<PublicFoodProjection[]> {
  const { data, error } = await publicSupabase
    .from('food_projection_public')
    .select('list_slug, food_name, brand, total_effective_servings, total_weight_grams')
    .eq('list_slug', slug)
    .order('food_name', { ascending: true })
  if (error) throw error
  assertPublicFoodProjectionRows(data)
  return data
}

// ---- Composite read (design 9.1): one plan assembled from owner-scoped reads.
export async function fetchFoodPlan(userId: string, listId: string): Promise<FoodPlanDocument | null> {
  const { data: plan, error } = await supabase
    .from('food_plans').select('*').eq('list_id', listId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!plan) return null
  const planId = (plan as FoodPlan).id
  const [meals, days, dayMeals, entries, dailyTargets, mealTargets] = await Promise.all([
    selectByPlan<Meal>('meals', planId, userId, 'sort_order'),
    selectByPlan<FoodPlanDay>('food_plan_days', planId, userId, 'sort_order'),
    selectByPlan<DayMeal>('day_meals', planId, userId, null),
    selectByPlan<FoodPlanEntry>('food_plan_entries', planId, userId, 'sort_order'),
    selectByPlan<FoodPlanDailyTarget>('food_plan_daily_targets', planId, userId, null),
    selectByPlan<MealTarget>('meal_targets', planId, userId, null),
  ])
  return { plan: plan as FoodPlan, meals, days, dayMeals, entries, dailyTargets, mealTargets }
}
async function selectByPlan<T>(
  table: 'meals' | 'food_plan_days' | 'day_meals' | 'food_plan_entries'
    | 'food_plan_daily_targets' | 'meal_targets',
  planId: string, userId: string, orderBy: string | null,
): Promise<T[]> {
  let q = supabase.from(table).select('*').eq('food_plan_id', planId).eq('user_id', userId)
  if (orderBy) q = q.order(orderBy, { ascending: true })
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as T[]
}

// ---- create_food_plan: caller passes the owner-chosen structure (subset grid).
export async function createFoodPlan(
  userId: string, listId: string, structure: FoodPlanStructure,
): Promise<FoodPlan> {
  const { data, error } = await supabase.rpc('create_food_plan', {
    p_user_id: userId, p_list_id: listId,
    p_meals: structure.meals, p_days: structure.days, p_day_meals: structure.dayMeals,
  })
  if (error) throw error
  return data as FoodPlan
}

// ---- server-authoritative schedule edits: ids + sort order only.
export async function addFoodPlanDay(userId: string, foodPlanId: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.rpc('add_food_plan_day', {
    p_user_id: userId, p_food_plan_id: foodPlanId, p_sort_order: sortOrder,
  })
  if (error) throw error
}
export async function addMealDefinition(userId: string, foodPlanId: string, name: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.rpc('add_meal_definition', {
    p_user_id: userId, p_food_plan_id: foodPlanId, p_name: name, p_sort_order: sortOrder,
  })
  if (error) throw error
}
export async function duplicateFoodPlanDay(userId: string, sourceDayId: string, sortOrder: number): Promise<void> {
  const { error } = await supabase.rpc('duplicate_food_plan_day', {
    p_user_id: userId, p_source_day_id: sourceDayId, p_sort_order: sortOrder,
  })
  if (error) throw error
}

// ---- upsert_food_plan_entry: ADD / COPY / MOVE with server-side merge.
export type EntryAddition = {
  id: string                 // minted id, used only if the target is empty and it is an add/copy
  food_plan_id: string
  day_meal_id: string | null
  is_extra: boolean
  food_item_id: string
  basis: EntryBasis
  amount: number
  sort_order: number
}
export async function upsertFoodPlanEntry(
  userId: string, addition: EntryAddition, preserveBasis: EntryBasis | null, moveSourceId: string | null,
): Promise<FoodPlanEntry> {
  const { data, error } = await supabase.rpc('upsert_food_plan_entry', {
    p_user_id: userId, p_entry: addition, p_preserve_basis: preserveBasis, p_move_source_id: moveSourceId,
  })
  if (error) throw error
  return data as FoodPlanEntry
}

export type EntryBatchAddition = {
  entry: EntryAddition
  preserve_basis: EntryBasis | null
}
export async function upsertFoodPlanEntries(
  userId: string, additions: EntryBatchAddition[],
): Promise<FoodPlanEntry[]> {
  const { data, error } = await supabase.rpc('upsert_food_plan_entries', {
    p_user_id: userId,
    p_additions: additions,
  })
  if (error) throw error
  return data as FoodPlanEntry[]
}

// ---- single-row writes (basis-validation trigger still fires).
export async function updateFoodPlanEntry(id: string, patch: Partial<Pick<FoodPlanEntry, 'basis' | 'amount'>>): Promise<void> {
  const { error } = await supabase.from('food_plan_entries').update(patch).eq('id', id); if (error) throw error
}
export async function deleteFoodPlanEntry(id: string): Promise<void> {
  const { error } = await supabase.from('food_plan_entries').delete().eq('id', id); if (error) throw error
}
export async function deleteFoodPlanDay(id: string): Promise<void> {
  const { error } = await supabase.from('food_plan_days').delete().eq('id', id); if (error) throw error
}
export async function updateDayType(id: string, override: 'full' | 'partial' | null): Promise<void> {
  const { error } = await supabase.from('food_plan_days').update({ day_type_override: override }).eq('id', id); if (error) throw error
}
export async function renameMeal(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('meals').update({ name }).eq('id', id); if (error) throw error
}
export async function deleteMeal(id: string): Promise<void> {
  const { error } = await supabase.from('meals').delete().eq('id', id); if (error) throw error
}
export async function deleteDayMeal(id: string): Promise<void> {
  const { error } = await supabase.from('day_meals').delete().eq('id', id); if (error) throw error
}
export async function addDayMeal(userId: string, foodPlanId: string, dayId: string, mealId: string): Promise<DayMeal> {
  const { data, error } = await supabase.from('day_meals')
    .insert({ id: randomTempId(), user_id: userId, food_plan_id: foodPlanId, day_id: dayId, meal_id: mealId })
    .select().single()
  if (error) throw error
  return data as DayMeal
}
export async function deleteFoodPlan(id: string): Promise<void> {
  const { error } = await supabase.from('food_plans').delete().eq('id', id); if (error) throw error
}

// ---- cap preflight.
export function assertFoodPlanDayWithinCap(existingDays: number): void {
  if (existingDays >= FOOD_PLAN_DAY_CAP) throw new Error(`This plan already has the maximum ${FOOD_PLAN_DAY_CAP} days.`)
}
export function assertMealDefinitionWithinCap(existingMeals: number): void {
  if (existingMeals >= MEAL_DEFINITION_CAP) throw new Error(`This plan already has the maximum ${MEAL_DEFINITION_CAP} meals.`)
}
export function assertFoodPlanEntryWithinCap(existingEntries: number): void {
  if (existingEntries >= FOOD_PLAN_ENTRY_CAP) throw new Error(`This plan already has the maximum ${FOOD_PLAN_ENTRY_CAP} entries.`)
}

// ---- Single-row, full-row target writes. RLS authorizes; ON CONFLICT updates
// the per-metric row in place. Input omits id so identity is never overwritten.
export async function upsertDailyTarget(target: DailyTargetInput): Promise<void> {
  // Allowlist the columns we forward: even if a caller leaks an id at runtime,
  // it is never sent, so ON CONFLICT can never overwrite the row's identity.
  const { user_id, food_plan_id, metric, mode, target_min, target_max } = target
  const payload = { user_id, food_plan_id, metric, mode, target_min, target_max }
  const { error } = await supabase
    .from('food_plan_daily_targets')
    .upsert(payload, { onConflict: 'food_plan_id,metric' })
  if (error) throw error
}

export async function deleteDailyTarget(id: string): Promise<void> {
  const { error } = await supabase.from('food_plan_daily_targets').delete().eq('id', id)
  if (error) throw error
}

export async function upsertMealTarget(target: MealTargetInput): Promise<void> {
  const { user_id, food_plan_id, meal_id, metric, mode, target_min, target_max } = target
  const payload = { user_id, food_plan_id, meal_id, metric, mode, target_min, target_max }
  const { error } = await supabase
    .from('meal_targets')
    .upsert(payload, { onConflict: 'meal_id,metric' })
  if (error) throw error
}

export async function deleteMealTarget(id: string): Promise<void> {
  const { error } = await supabase.from('meal_targets').delete().eq('id', id)
  if (error) throw error
}

export type TargetsSavePayload = {
  dailyUpserts: { metric: DailyTargetMetric; mode: TargetMode; target_min: number | null; target_max: number | null }[]
  dailyDeletes: DailyTargetMetric[]
  mealUpserts: { meal_id: string; metric: MealTargetMetric; mode: TargetMode; target_min: number | null; target_max: number | null }[]
  mealDeletes: { meal_id: string; metric: MealTargetMetric }[]
}

// One transactional save: all upserts/deletes commit together (see RPC).
export async function saveFoodPlanTargets(userId: string, foodPlanId: string, payload: TargetsSavePayload): Promise<void> {
  const { error } = await supabase.rpc('save_food_plan_targets', {
    p_user_id: userId,
    p_food_plan_id: foodPlanId,
    p_daily_upserts: payload.dailyUpserts,
    p_daily_deletes: payload.dailyDeletes,
    p_meal_upserts: payload.mealUpserts,
    p_meal_deletes: payload.mealDeletes,
  })
  if (error) throw error
}
