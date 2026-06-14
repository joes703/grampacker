import type { GearStatus } from './gear-status'

export type List = {
  id: string
  user_id: string
  name: string
  description: string | null
  slug: string
  is_shared: boolean
  sort_order: number
  // Per-list organization toggle. When true, is_worn list_items are pulled
  // out of their categories and rendered in a trailing "Worn" section in
  // both normal and pack mode, and on the public /r/<slug> share view.
  // Default false; persisted in public.lists.group_worn.
  group_worn: boolean
  // Per-list pack-mode toggle for Ready Checks (optional second checkbox
  // column). Default false. NOT exposed on PublicList — share viewers
  // never see pack-mode state.
  ready_checks_enabled: boolean
  // Draft (still being built) vs complete. Completeness LABEL only - never
  // locks editing, independent of is_shared. Default true for new lists
  // (DB default); existing lists were backfilled false. Exposed on PublicList
  // so the share view can render a "work in progress" banner.
  is_draft: boolean
  created_at: string
  updated_at: string
}

export type ListItem = {
  id: string
  list_id: string
  user_id: string
  gear_item_id: string
  quantity: number
  is_worn: boolean
  is_consumable: boolean
  is_packed: boolean
  // Pack-mode Ready check — independent of is_packed. Surfaced only when
  // the owning list has ready_checks_enabled = true. NOT exposed on
  // PublicListItem; share viewers never see pack-mode state.
  is_ready: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// ListItem joined with its source GearItem. Always present: gear_item_id is
// NOT NULL with ON DELETE CASCADE, so a list_item cannot outlive its gear.
export type ListItemWithGear = ListItem & {
  gear_item: Pick<
    GearItem,
    'id' | 'name' | 'description' | 'weight_grams' | 'category_id' | 'status'
  >
}

export type Category = {
  id: string
  user_id: string
  name: string
  sort_order: number
  is_default: boolean
  created_at: string
}

export type GearItem = {
  id: string
  user_id: string
  category_id: string | null
  name: string
  description: string | null
  weight_grams: number
  // Display-only inventory metadata. Nullable because many items have
  // unknown values (gifts, old gear). Not part of any pack-weight or
  // trip calculation, and not surfaced in list views or public shares —
  // see PublicGearItem and ListItemWithGear.gear_item, both of which
  // intentionally omit these. cost is USD; purchase_date is ISO YYYY-MM-DD.
  cost: number | null
  purchase_date: string | null
  // Advisory inventory metadata. NOT NULL with default 'active' in the DB
  // (migration 20260516000000). Surfaced in private views (gear library,
  // gear picker, private list rows) but explicitly excluded from public
  // share projections — see PublicGearItem below. Type pinned to GearStatus
  // so the union and the CHECK constraint stay in lockstep.
  status: GearStatus
  sort_order: number
  created_at: string
  updated_at: string
}

// Account-wide food library row (migration 20260611120000). Owner-scoped
// inventory of foods; per-trip usage lives in the Food plan (later phases),
// never here. Required: name, serving_weight_grams, calories_per_serving.
// Every nutrient column is nullable because null means "unknown", never
// zero — see the Food Planning technical design 1.1.
export type FoodItem = {
  id: string
  user_id: string
  name: string
  brand: string | null
  serving_description: string | null
  serving_weight_grams: number
  calories_per_serving: number
  servings_per_package: number | null
  fat_grams: number | null
  saturated_fat_grams: number | null
  carbs_grams: number | null
  fiber_grams: number | null
  sugar_grams: number | null
  protein_grams: number | null
  sodium_mg: number | null
  potassium_mg: number | null
  notes: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

// Narrower response shapes for public read paths (/r/<slug>). Fewer columns
// than the authenticated equivalents — see SECURITY.md "Public read paths"
// for the allowlist rationale. SharePage maps these to the full types at the
// boundary before passing items/categories to shared components.

export type PublicList = Pick<List, 'id' | 'name' | 'description' | 'group_worn' | 'is_draft'>

export type PublicGearItem = Pick<
  GearItem,
  'id' | 'name' | 'description' | 'weight_grams' | 'category_id'
>

export type PublicListItem = Pick<
  ListItem,
  'id' | 'gear_item_id' | 'quantity' | 'is_worn' | 'is_consumable' | 'sort_order'
> & {
  gear_item: PublicGearItem
}

export type PublicCategory = Pick<Category, 'id' | 'name' | 'sort_order'>

export type EntryBasis = 'servings' | 'packages' | 'weight'

export type FoodPlan = {
  id: string; user_id: string; list_id: string
  is_food_shared: boolean
  created_at: string; updated_at: string
}
export type Meal = {
  id: string; user_id: string; food_plan_id: string
  name: string; anchor_role: 'breakfast' | 'dinner' | null; is_default: boolean
  sort_order: number; created_at: string; updated_at: string
}
export type FoodPlanDay = {
  id: string; user_id: string; food_plan_id: string
  day_type_override: 'full' | 'partial' | null
  sort_order: number; created_at: string; updated_at: string
}
export type DayMeal = {
  id: string; user_id: string; food_plan_id: string
  day_id: string; meal_id: string; created_at: string; updated_at: string
}
export type FoodPlanEntry = {
  id: string; user_id: string; food_plan_id: string
  day_meal_id: string | null; is_extra: boolean; food_item_id: string
  basis: EntryBasis; amount: number; sort_order: number
  created_at: string; updated_at: string
}
export type TargetMode = 'range' | 'min' | 'max' | 'off'
export type DailyTargetMetric = 'calories' | 'protein' | 'carbs' | 'fiber' | 'sodium' | 'calorie_density'
export type MealTargetMetric = 'calories' | 'protein' | 'fat_pct' | 'sugar_pct' | 'carb_protein_ratio'

export type FoodPlanDailyTarget = {
  id: string; user_id: string; food_plan_id: string
  metric: DailyTargetMetric; mode: TargetMode
  target_min: number | null; target_max: number | null
}
export type MealTarget = {
  id: string; user_id: string; food_plan_id: string; meal_id: string
  metric: MealTargetMetric; mode: TargetMode
  target_min: number | null; target_max: number | null
}

// Write inputs OMIT id: insert mints it (gen_random_uuid default) and ON CONFLICT
// preserves the existing row's id. The `id?: never` guard makes passing a full
// row (with id: string) a COMPILE error - Omit alone would let a wider variable
// through (excess-property checks skip variables, not just object literals). The
// upsert functions ALSO allowlist the columns at runtime, so even a leaked id
// can never be forwarded. See upsert* in queries/food-plan.ts.
export type DailyTargetInput = Omit<FoodPlanDailyTarget, 'id'> & { id?: never }
export type MealTargetInput = Omit<MealTarget, 'id'> & { id?: never }

// User-scoped default daily targets (Phase 3B-iii). Daily-only in v1. Copied
// into new plans server-side by create_food_plan; the plan owns its copy. A
// stored default is ALWAYS active: the table CHECK forbids mode='off' (Off is an
// editor action that deletes the row), so the row type excludes 'off'.
export type TargetDefault = {
  id: string; user_id: string
  metric: DailyTargetMetric; mode: Exclude<TargetMode, 'off'>
  target_min: number | null; target_max: number | null
}
// A single active default sent to save_target_defaults (mode is never 'off';
// switching to Off emits a delete instead).
export type DailyDefaultUpsert = {
  metric: DailyTargetMetric
  mode: Exclude<TargetMode, 'off'>
  target_min: number | null; target_max: number | null
}

// The whole plan assembled by fetchFoodPlan. Daily/meal targets added in Phase 3.
export type FoodPlanDocument = {
  plan: FoodPlan; meals: Meal[]; days: FoodPlanDay[]; dayMeals: DayMeal[]; entries: FoodPlanEntry[]
  dailyTargets: FoodPlanDailyTarget[]; mealTargets: MealTarget[]
}
