// Pure mapping from the design sample dataset (food-design-sample-data.mjs) to
// production DB row payloads for the food-plan tables. NO side effects: no
// Supabase, no filesystem, no randomness. The runtime seed script injects a
// `genId` (crypto.randomUUID) and the owner's existing food_items so this stays
// deterministic and unit-testable. Schema reference (verified against
// supabase/migrations): food_plan_entries.basis IN ('servings','packages',
// 'weight'); food_plan_daily_targets.metric IN ('calories','protein','carbs',
// 'fiber','sodium','calorie_density'); meal_targets.metric IN ('calories',
// 'protein','fat_pct','sugar_pct','carb_protein_ratio'); both target tables use
// mode IN ('range','min','max','off') with target_min/target_max.

// Grams per ounce. Mirrors OZ in `docs/design/.../fp/data.jsx` and the canonical
// conversion behind `inputToKcalPerGram` in src/food/nutrition-format.ts. Kept
// inline because this .mjs script cannot import the TS app module at runtime.
const OZ = 28.3495

const emptyToNull = (s) => (s == null || s === '' ? null : s)

// Prototype basis ('serving'|'package'|'weight') -> production enum.
export function mapBasis(protoBasis) {
  switch (protoBasis) {
    case 'serving': return 'servings'
    case 'package': return 'packages'
    case 'weight': return 'weight'
    default: throw new Error(`Unknown prototype basis: ${protoBasis}`)
  }
}

// Design daily metric -> production daily-target metric, or null to DROP it
// (potassium has no production daily metric).
function mapDailyMetric(metric) {
  switch (metric) {
    case 'cal': return 'calories'
    case 'protein': return 'protein'
    case 'carbs': return 'carbs'
    case 'fiber': return 'fiber'
    case 'sodium': return 'sodium'
    case 'density': return 'calorie_density'
    case 'potassium': return null
    default: throw new Error(`Unknown daily metric: ${metric}`)
  }
}

// Design meal metric -> production meal-target metric.
function mapMealMetric(metric) {
  switch (metric) {
    case 'cal': return 'calories'
    case 'protein': return 'protein'
    default: throw new Error(`Unsupported meal-target metric: ${metric}`)
  }
}

// Design mode ('band'|'floor'|'ceiling'|'off') -> production mode.
function mapMode(mode) {
  switch (mode) {
    case 'band': return 'range'
    case 'floor': return 'min'
    case 'ceiling': return 'max'
    case 'off': return 'off'
    default: throw new Error(`Unknown target mode: ${mode}`)
  }
}

// kcal/oz -> canonical kcal/g (how calorie_density targets are stored).
export function densityKcalPerGram(kcalPerOz) {
  return kcalPerOz / OZ
}

// Design food -> food_items insert payload (sans id/user_id/sort_order, added by
// buildSeedPlan). Preserves null (unknown) and 0 (measured); empty text -> null.
export function toFoodItemInput(food) {
  return {
    name: food.name,
    brand: emptyToNull(food.brand),
    serving_description: emptyToNull(food.serving),
    serving_weight_grams: food.servingWeightG,
    calories_per_serving: food.cal,
    servings_per_package: food.perPkg ?? null,
    fat_grams: food.fat,
    saturated_fat_grams: food.sat,
    carbs_grams: food.carbs,
    fiber_grams: food.fiber,
    sugar_grams: food.sugar,
    protein_grams: food.protein,
    sodium_mg: food.sodium,
    potassium_mg: food.potassium,
    notes: emptyToNull(food.notes),
  }
}

// Match an existing owned food_item to a design food by (name, brand). Used so
// re-running the seed reuses library rows instead of cloning all 22 foods.
function matchExisting(food, existing) {
  const brand = emptyToNull(food.brand)
  return existing.find((e) => e.name === food.name && (e.brand ?? null) === brand) ?? null
}

function modeBounds(mode, src) {
  // src carries either {min,max} (band) or {value} (floor/ceiling).
  switch (mode) {
    case 'band': return { target_min: src.min, target_max: src.max }
    case 'floor': return { target_min: src.value, target_max: null }
    case 'ceiling': return { target_min: null, target_max: src.value }
    case 'off': return { target_min: null, target_max: null }
    default: throw new Error(`Unknown target mode: ${mode}`)
  }
}

// Build every DB row payload for the seed. Returns a plain object of arrays plus
// the single food_plan row and a reused-food count. Deliberately contains NO
// pack-state: the seed never writes food_pack_state (and never sets
// is_food_shared, which defaults false). All rows carry user_id = the owner.
//
// Args:
//   data: { FOODS, MEALS, DAILY_TARGETS, DAYS, EXTRAS, PLAN }
//   userId: owner uuid (= the signed-in account)
//   listId: target list uuid
//   genId: () => uuid (crypto.randomUUID at runtime; a counter in tests)
//   existingFoods: [{ id, name, brand, sort_order }] already in the owner library
export function buildSeedPlan({ data, userId, listId, genId, existingFoods = [] }) {
  const { FOODS, MEALS, DAILY_TARGETS, DAYS, EXTRAS, PLAN } = data

  // --- Foods: reuse existing by (name, brand), insert the rest. -----------
  const startSort = existingFoods.reduce((m, e) => Math.max(m, (e.sort_order ?? -1) + 1), 0)
  const foodIdByProto = new Map()
  const foodItemsToInsert = []
  let reusedFoodCount = 0
  for (const food of FOODS) {
    const hit = matchExisting(food, existingFoods)
    if (hit) {
      foodIdByProto.set(food.id, hit.id)
      reusedFoodCount += 1
      continue
    }
    const id = genId()
    foodIdByProto.set(food.id, id)
    foodItemsToInsert.push({
      id,
      user_id: userId,
      sort_order: startSort + foodItemsToInsert.length,
      ...toFoodItemInput(food),
    })
  }
  const foodIdFor = (proto) => {
    const id = foodIdByProto.get(proto)
    if (!id) throw new Error(`No food id for prototype food '${proto}'`)
    return id
  }

  // --- Plan -----------------------------------------------------------------
  const foodPlanId = genId()
  const foodPlan = { id: foodPlanId, user_id: userId, list_id: listId, num_nights: PLAN.days }

  // --- Meals ----------------------------------------------------------------
  const mealIdByProto = new Map()
  const meals = MEALS.map((m, i) => {
    const id = genId()
    mealIdByProto.set(m.id, id)
    return { id, user_id: userId, food_plan_id: foodPlanId, name: m.name, anchor_role: m.anchor, is_default: m.defaultMeal, sort_order: i }
  })

  // --- Days, day_meals (schedule), entries ---------------------------------
  const days = []
  const dayMeals = []
  const entries = []
  const dayMealIdByKey = new Map() // `${dayN}:${mealProtoId}` -> day_meal id
  DAYS.forEach((day, dayIdx) => {
    const dayId = genId()
    days.push({ id: dayId, user_id: userId, food_plan_id: foodPlanId, day_type_override: null, sort_order: dayIdx })
    // Scheduled meals = MEALS not in this day's omit list (preserve MEALS order).
    const scheduled = MEALS.filter((m) => !day.omit.includes(m.id))
    for (const meal of scheduled) {
      const dayMealId = genId()
      dayMeals.push({ id: dayMealId, user_id: userId, food_plan_id: foodPlanId, day_id: dayId, meal_id: mealIdByProto.get(meal.id) })
      dayMealIdByKey.set(`${day.n}:${meal.id}`, dayMealId)
      const cellEntries = day.meals[meal.id] ?? []
      cellEntries.forEach((e, i) => {
        entries.push({
          id: genId(),
          user_id: userId,
          food_plan_id: foodPlanId,
          day_meal_id: dayMealId,
          is_extra: false,
          food_item_id: foodIdFor(e.food),
          basis: mapBasis(e.basis),
          amount: e.amt,
          sort_order: i,
        })
      })
    }
  })

  // --- Extras (is_extra, no day_meal) --------------------------------------
  EXTRAS.forEach((e, i) => {
    entries.push({
      id: genId(),
      user_id: userId,
      food_plan_id: foodPlanId,
      day_meal_id: null,
      is_extra: true,
      food_item_id: foodIdFor(e.food),
      basis: mapBasis(e.basis),
      amount: e.amt,
      sort_order: i,
    })
  })

  // --- Daily targets (drop unsupported metrics, convert density) -----------
  const dailyTargets = []
  for (const t of DAILY_TARGETS) {
    const metric = mapDailyMetric(t.metric)
    if (metric === null) continue // potassium: no production metric
    let { target_min, target_max } = modeBounds(t.mode, t)
    if (metric === 'calorie_density') {
      target_min = target_min == null ? null : densityKcalPerGram(target_min)
      target_max = target_max == null ? null : densityKcalPerGram(target_max)
    }
    dailyTargets.push({ id: genId(), user_id: userId, food_plan_id: foodPlanId, metric, mode: mapMode(t.mode), target_min, target_max })
  }

  // --- Meal targets ---------------------------------------------------------
  const mealTargets = []
  for (const m of MEALS) {
    if (!m.target) continue // Happy hour has none
    const { target_min, target_max } = modeBounds(m.target.mode, m.target)
    mealTargets.push({
      id: genId(),
      user_id: userId,
      food_plan_id: foodPlanId,
      meal_id: mealIdByProto.get(m.id),
      metric: mapMealMetric(m.target.metric),
      mode: mapMode(m.target.mode),
      target_min,
      target_max,
    })
  }

  return { foodItemsToInsert, reusedFoodCount, foodPlan, meals, days, dayMeals, entries, dailyTargets, mealTargets }
}
