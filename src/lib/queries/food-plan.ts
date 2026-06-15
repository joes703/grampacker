import { publicSupabase, supabase } from '../supabase'
import { randomTempId } from '../random-temp-id'
import { FOOD_PLAN_DAY_CAP, MEAL_DEFINITION_CAP, FOOD_PLAN_ENTRY_CAP } from '../caps'
import type { FoodPlanStructure } from '../food/basis'
import type {
  FoodPlan, Meal, FoodPlanDay, DayMeal, FoodPlanEntry, FoodPlanDocument, EntryBasis,
  FoodPlanDailyTarget, MealTarget, DailyTargetInput, MealTargetInput,
  DailyTargetMetric, MealTargetMetric, TargetMode, PublicFoodPlanDocument,
} from '../types'

// ---- Public aggregate food weight (shared Gear list, no auth).
// Public Gear shares show total carried food WEIGHT only -- never the menu.
// The summary RPC is SECURITY DEFINER, gated on lists.is_shared, and returns a
// single number. Itemized food stays behind fetchSharedFoodPlan (dual-gated).
export async function fetchSharedFoodSummary(slug: string): Promise<number> {
  const { data, error } = await publicSupabase.rpc('food_projection_public_summary', { p_slug: slug })
  if (error) throw error
  if (typeof data !== 'number' || !Number.isFinite(data) || data < 0) {
    throw new Error(`Unexpected public food summary response shape: expected a non-negative number, got ${typeof data}`)
  }
  return data
}

// ---- Public detailed Food plan (shared Gear list + Include Food plan).
const FORBIDDEN_PUBLIC_FOOD_PLAN_KEYS = new Set([
  'user_id',
  'list_id',
  'food_plan_id',
  'notes',
  'created_at',
  'updated_at',
  'is_packed',
  'packed_signature',
])

function assertNoForbiddenPublicFoodPlanKeys(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoForbiddenPublicFoodPlanKeys(item, `${path}[${i}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_FOOD_PLAN_KEYS.has(key)) {
      throw new Error(`Unexpected public food plan response shape: ${path}.${key} is forbidden`)
    }
    assertNoForbiddenPublicFoodPlanKeys(child, `${path}.${key}`)
  }
}

function assertStringField(row: Record<string, unknown>, field: string, context: string): void {
  if (typeof row[field] !== 'string') {
    throw new Error(`Unexpected public food plan response shape: ${context}.${field} is not a string`)
  }
}
function assertNullableStringField(row: Record<string, unknown>, field: string, context: string): void {
  if (row[field] !== null && typeof row[field] !== 'string') {
    throw new Error(`Unexpected public food plan response shape: ${context}.${field} is not a string or null`)
  }
}
function assertNumberField(row: Record<string, unknown>, field: string, context: string): void {
  if (typeof row[field] !== 'number') {
    throw new Error(`Unexpected public food plan response shape: ${context}.${field} is not a number`)
  }
}
function assertNullableNumberField(row: Record<string, unknown>, field: string, context: string): void {
  if (row[field] !== null && typeof row[field] !== 'number') {
    throw new Error(`Unexpected public food plan response shape: ${context}.${field} is not a number or null`)
  }
}
function assertBooleanField(row: Record<string, unknown>, field: string, context: string): void {
  if (typeof row[field] !== 'boolean') {
    throw new Error(`Unexpected public food plan response shape: ${context}.${field} is not a boolean`)
  }
}
function assertArrayField(row: Record<string, unknown>, field: string): unknown[] {
  const value = row[field]
  if (!Array.isArray(value)) {
    throw new Error(`Unexpected public food plan response shape: ${field} is not an array`)
  }
  return value
}
function assertObject(value: unknown, context: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Unexpected public food plan response shape: ${context} is not an object`)
  }
}
function assertEntryBasis(value: unknown, context: string): void {
  if (value !== 'servings' && value !== 'packages' && value !== 'weight') {
    throw new Error(`Unexpected public food plan response shape: ${context}.basis is not a valid basis`)
  }
}
function assertTargetMode(value: unknown, context: string): void {
  if (value !== 'range' && value !== 'min' && value !== 'max' && value !== 'off') {
    throw new Error(`Unexpected public food plan response shape: ${context}.mode is not a valid target mode`)
  }
}

function assertPublicFoodPlanDocument(data: unknown): asserts data is PublicFoodPlanDocument | null {
  if (data === null) return
  assertObject(data, 'document')
  assertNoForbiddenPublicFoodPlanKeys(data)
  assertObject(data.plan, 'plan')
  assertStringField(data.plan, 'id', 'plan')
  assertStringField(data.plan, 'list_slug', 'plan')

  assertArrayField(data, 'meals').forEach((item, i) => {
    assertObject(item, `meals[${i}]`)
    assertStringField(item, 'id', `meals[${i}]`)
    assertStringField(item, 'name', `meals[${i}]`)
    assertNullableStringField(item, 'anchor_role', `meals[${i}]`)
    assertBooleanField(item, 'is_default', `meals[${i}]`)
    assertNumberField(item, 'sort_order', `meals[${i}]`)
  })
  assertArrayField(data, 'days').forEach((item, i) => {
    assertObject(item, `days[${i}]`)
    assertStringField(item, 'id', `days[${i}]`)
    assertNullableStringField(item, 'day_type_override', `days[${i}]`)
    assertNumberField(item, 'sort_order', `days[${i}]`)
  })
  assertArrayField(data, 'dayMeals').forEach((item, i) => {
    assertObject(item, `dayMeals[${i}]`)
    assertStringField(item, 'id', `dayMeals[${i}]`)
    assertStringField(item, 'day_id', `dayMeals[${i}]`)
    assertStringField(item, 'meal_id', `dayMeals[${i}]`)
  })
  assertArrayField(data, 'entries').forEach((item, i) => {
    assertObject(item, `entries[${i}]`)
    assertStringField(item, 'id', `entries[${i}]`)
    assertNullableStringField(item, 'day_meal_id', `entries[${i}]`)
    assertBooleanField(item, 'is_extra', `entries[${i}]`)
    assertStringField(item, 'food_item_id', `entries[${i}]`)
    assertEntryBasis(item.basis, `entries[${i}]`)
    assertNumberField(item, 'amount', `entries[${i}]`)
    assertNumberField(item, 'sort_order', `entries[${i}]`)
  })
  assertArrayField(data, 'foods').forEach((item, i) => {
    assertObject(item, `foods[${i}]`)
    assertStringField(item, 'id', `foods[${i}]`)
    assertStringField(item, 'name', `foods[${i}]`)
    assertNullableStringField(item, 'brand', `foods[${i}]`)
    assertNullableStringField(item, 'serving_description', `foods[${i}]`)
    assertNumberField(item, 'serving_weight_grams', `foods[${i}]`)
    assertNumberField(item, 'calories_per_serving', `foods[${i}]`)
    for (const field of ['servings_per_package', 'fat_grams', 'saturated_fat_grams', 'carbs_grams', 'fiber_grams', 'sugar_grams', 'protein_grams', 'sodium_mg', 'potassium_mg']) {
      assertNullableNumberField(item, field, `foods[${i}]`)
    }
    assertNumberField(item, 'sort_order', `foods[${i}]`)
  })
  assertArrayField(data, 'dailyTargets').forEach((item, i) => {
    assertObject(item, `dailyTargets[${i}]`)
    assertStringField(item, 'id', `dailyTargets[${i}]`)
    assertStringField(item, 'metric', `dailyTargets[${i}]`)
    assertTargetMode(item.mode, `dailyTargets[${i}]`)
    assertNullableNumberField(item, 'target_min', `dailyTargets[${i}]`)
    assertNullableNumberField(item, 'target_max', `dailyTargets[${i}]`)
  })
  assertArrayField(data, 'mealTargets').forEach((item, i) => {
    assertObject(item, `mealTargets[${i}]`)
    assertStringField(item, 'id', `mealTargets[${i}]`)
    assertStringField(item, 'meal_id', `mealTargets[${i}]`)
    assertStringField(item, 'metric', `mealTargets[${i}]`)
    assertTargetMode(item.mode, `mealTargets[${i}]`)
    assertNullableNumberField(item, 'target_min', `mealTargets[${i}]`)
    assertNullableNumberField(item, 'target_max', `mealTargets[${i}]`)
  })
}

export async function fetchSharedFoodPlan(slug: string): Promise<PublicFoodPlanDocument | null> {
  const { data, error } = await publicSupabase.rpc('get_public_food_plan', { p_slug: slug })
  if (error) throw error
  assertPublicFoodPlanDocument(data)
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

export type FoodPlanCopyOption = {
  food_plan_id: string
  list_id: string
  list_name: string
}

export async function fetchFoodPlanCopyOptions(userId: string, targetListId: string): Promise<FoodPlanCopyOption[]> {
  const { data: plans, error: plansError } = await supabase
    .from('food_plans')
    .select('id, list_id, created_at')
    .eq('user_id', userId)
    .neq('list_id', targetListId)
    .order('created_at', { ascending: false })
  if (plansError) throw plansError
  const rows = (plans ?? []) as { id: string; list_id: string }[]
  if (rows.length === 0) return []

  const listIds = rows.map((row) => row.list_id)
  const { data: lists, error: listsError } = await supabase
    .from('lists')
    .select('id, name')
    .eq('user_id', userId)
    .in('id', listIds)
  if (listsError) throw listsError

  const listNameById = new Map((lists ?? []).map((list) => {
    const row = list as { id: string; name: string }
    return [row.id, row.name]
  }))
  return rows
    .map((row) => {
      const name = listNameById.get(row.list_id)
      return name ? { food_plan_id: row.id, list_id: row.list_id, list_name: name } : null
    })
    .filter((row): row is FoodPlanCopyOption => row !== null)
}

export async function copyFoodPlanToList(userId: string, sourceFoodPlanId: string, targetListId: string): Promise<FoodPlan> {
  const { data, error } = await supabase.rpc('copy_food_plan_to_list', {
    p_user_id: userId,
    p_source_food_plan_id: sourceFoodPlanId,
    p_target_list_id: targetListId,
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

export async function updateFoodPlanShare(foodPlanId: string, isFoodShared: boolean): Promise<void> {
  const { error } = await supabase
    .from('food_plans')
    .update({ is_food_shared: isFoodShared })
    .eq('id', foodPlanId)
  if (error) throw error
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
