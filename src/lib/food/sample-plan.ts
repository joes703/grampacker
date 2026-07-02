// Canonical "Wind River high route" sample Food plan for the in-app "Load sample
// plan" onboarding helper. The dataset is a faithful port of the approved
// Claude Design study fixture and mirrors scripts/food-design-sample-data.mjs row-for-row - a parity test
// (scripts/sample-plan-parity.test.mjs) fails if the two drift. null = genuinely
// unknown (NEVER stored as 0); 0 = a measured zero (e.g. olive oil sodium).
//
// buildSampleFoodPlanPayload() resolves this static dataset into the JSONB the
// create_sample_food_plan RPC inserts atomically: it mints client UUIDs, dedupes
// foods against the owner's existing library by name + brand, maps the prototype
// basis to the production enum, drops the unsupported potassium daily target,
// and converts the kcal/oz density target to the canonical kcal/g the DB stores.
import type { EntryBasis, DailyTargetMetric, MealTargetMetric, TargetMode } from '../types'

// ---- Prototype-shape dataset (kept identical to the .mjs for the parity test).
type ProtoFood = {
  id: string; name: string; brand: string; serving: string; servingWeightG: number
  perPkg: number | null; cal: number; fat: number | null; sat: number | null; carbs: number | null
  fiber: number | null; sugar: number | null; protein: number | null; sodium: number | null
  potassium: number | null; notes: string
}
type ProtoMeal = {
  id: string; name: string; defaultMeal: boolean; anchor: 'breakfast' | 'dinner' | null
  target: { metric: 'cal' | 'protein'; mode: 'floor'; value: number } | null
}
type ProtoDailyTarget = {
  metric: 'cal' | 'protein' | 'carbs' | 'fiber' | 'sodium' | 'density' | 'potassium'
  mode: 'band' | 'floor' | 'ceiling' | 'off'; min?: number; max?: number; value?: number; unit?: string
}
type ProtoEntry = { food: string; basis: 'serving' | 'package' | 'weight'; amt: number }
type ProtoDay = { n: number; label: string; note: string | null; omit: string[]; meals: Record<string, ProtoEntry[]> }

export const FOODS: ProtoFood[] = [
  { id: 'oats',     name: 'Instant oatmeal',         brand: 'Quaker',         serving: '1 packet',   servingWeightG: 43,  perPkg: 1,    cal: 150, fat: 3,    sat: 0.5,  carbs: 27, fiber: 3,    sugar: 12, protein: 4,    sodium: 100,  potassium: 130,  notes: 'Add hot water; doubles as a base for add-ins.' },
  { id: 'coffee',   name: 'Instant coffee',          brand: 'Starbucks Via',  serving: '1 stick',    servingWeightG: 2.3, perPkg: 1,    cal: 5,   fat: null, sat: null, carbs: 0,  fiber: 0,    sugar: 0,  protein: null, sodium: null, potassium: null, notes: 'Label only lists calories. Macros unknown.' },
  { id: 'milk',     name: 'Powdered milk',           brand: 'Nido',           serving: '3 tbsp',     servingWeightG: 24,  perPkg: 8,    cal: 80,  fat: 0,    sat: 0,    carbs: 12, fiber: 0,    sugar: 12, protein: 8,    sodium: 120,  potassium: 380,  notes: '' },
  { id: 'probar',   name: 'Meal bar',                brand: 'ProBar',         serving: '1 bar',      servingWeightG: 85,  perPkg: 1,    cal: 370, fat: 18,   sat: 3,    carbs: 44, fiber: 5,    sugar: 22, protein: 9,    sodium: 150,  potassium: 350,  notes: '' },
  { id: 'clif',     name: 'Energy bar, crunchy PB',  brand: 'Clif',           serving: '1 bar',      servingWeightG: 68,  perPkg: 1,    cal: 260, fat: 9,    sat: 2,    carbs: 39, fiber: 5,    sugar: 17, protein: 9,    sodium: 200,  potassium: 250,  notes: '' },
  { id: 'trailmix', name: 'Trail mix',               brand: 'Bulk bin',       serving: '30 g',       servingWeightG: 30,  perPkg: null, cal: 150, fat: 9,    sat: 1.5,  carbs: 14, fiber: 2,    sugar: 8,  protein: 4,    sodium: 45,   potassium: 160,  notes: 'Bought by weight - no fixed package.' },
  { id: 'pnut',     name: 'Peanut butter packet',    brand: "Justin's",       serving: '1 packet',   servingWeightG: 32,  perPkg: 1,    cal: 190, fat: 16,   sat: 2.5,  carbs: 7,  fiber: 2,    sugar: 2,  protein: 7,    sodium: 65,   potassium: null, notes: 'Potassium not on label.' },
  { id: 'strog',    name: 'Beef stroganoff',         brand: 'Mountain House', serving: '1 cup',      servingWeightG: 70,  perPkg: 2,    cal: 250, fat: 9,    sat: 4,    carbs: 32, fiber: 2,    sugar: 4,  protein: 11,   sodium: 720,  potassium: 300,  notes: 'Pouch is 2 servings.' },
  { id: 'pasta',    name: 'Pasta side, alfredo',     brand: 'Knorr',          serving: '1/2 pouch',  servingWeightG: 61,  perPkg: 2,    cal: 240, fat: 6,    sat: 3,    carbs: 41, fiber: 2,    sugar: 3,  protein: 8,    sodium: 770,  potassium: 200,  notes: '' },
  { id: 'oil',      name: 'Olive oil',               brand: '',               serving: '1 tbsp',     servingWeightG: 14,  perPkg: null, cal: 120, fat: 14,   sat: 2,    carbs: 0,  fiber: 0,    sugar: 0,  protein: 0,    sodium: 0,    potassium: 0,    notes: 'Calorie-dense dinner add.' },
  { id: 'tort',     name: 'Flour tortilla',          brand: 'Mission',        serving: '1 tortilla', servingWeightG: 49,  perPkg: 8,    cal: 140, fat: 4,    sat: 1.5,  carbs: 24, fiber: 1,    sugar: 1,  protein: 4,    sodium: 350,  potassium: 70,   notes: '' },
  { id: 'saus',     name: 'Summer sausage',          brand: 'Hickory Farms',  serving: '28 g',       servingWeightG: 28,  perPkg: null, cal: 110, fat: 10,   sat: 4,    carbs: 1,  fiber: 0,    sugar: 0,  protein: 5,    sodium: 430,  potassium: 90,   notes: 'Sliced from a chub - entered by weight.' },
  { id: 'cheese',   name: 'Cheddar cheese',          brand: 'Tillamook',      serving: '28 g',       servingWeightG: 28,  perPkg: null, cal: 110, fat: 9,    sat: 6,    carbs: 1,  fiber: 0,    sugar: 0,  protein: 7,    sodium: 180,  potassium: 28,   notes: '' },
  { id: 'tuna',     name: 'Tuna packet',             brand: 'StarKist',       serving: '1 pouch',    servingWeightG: 74,  perPkg: 1,    cal: 80,  fat: 1,    sat: 0,    carbs: 0,  fiber: 0,    sugar: 0,  protein: 17,   sodium: 230,  potassium: 200,  notes: '' },
  { id: 'beans',    name: 'Dehydrated refried beans', brand: 'Harmony House', serving: '1/3 cup',    servingWeightG: 35,  perPkg: 6,    cal: 120, fat: 1,    sat: 0,    carbs: 20, fiber: 7,    sugar: 1,  protein: 7,    sodium: 330,  potassium: 500,  notes: '' },
  { id: 'snick',    name: 'Chocolate bar',           brand: 'Snickers',       serving: '1 bar',      servingWeightG: 52,  perPkg: 1,    cal: 250, fat: 12,   sat: 4.5,  carbs: 33, fiber: 1,    sugar: 27, protein: 4,    sodium: 120,  potassium: 150,  notes: '' },
  { id: 'waffle',   name: 'Energy waffle',           brand: 'Honey Stinger',  serving: '1 waffle',   servingWeightG: 30,  perPkg: 1,    cal: 140, fat: 6,    sat: 2.5,  carbs: 21, fiber: 0,    sugar: 9,  protein: 1,    sodium: 50,   potassium: null, notes: '' },
  { id: 'mms',      name: 'Peanut candies',          brand: "M&M's",          serving: '1/4 cup',    servingWeightG: 40,  perPkg: 1,    cal: 200, fat: 10,   sat: 4,    carbs: 24, fiber: 2,    sugar: 21, protein: 4,    sodium: 20,   potassium: 130,  notes: '' },
  { id: 'lyte',     name: 'Electrolyte mix',         brand: 'LMNT',           serving: '1 stick',    servingWeightG: 6,   perPkg: 1,    cal: 10,  fat: 0,    sat: 0,    carbs: 2,  fiber: 0,    sugar: 0,  protein: 0,    sodium: 1000, potassium: 200,  notes: '' },
  { id: 'leather',  name: 'Fruit leather',           brand: 'Homemade',       serving: '1 strip',    servingWeightG: 15,  perPkg: null, cal: 45,  fat: null, sat: null, carbs: 11, fiber: null, sugar: 9,  protein: null, sodium: null, potassium: null, notes: 'Homemade - only calories, carbs and sugar measured.' },
  { id: 'choc',     name: 'Dark chocolate',          brand: "Lily's",         serving: '2 squares',  servingWeightG: 20,  perPkg: 5,    cal: 110, fat: 8,    sat: 5,    carbs: 9,  fiber: 2,    sugar: 5,  protein: 2,    sodium: 5,    potassium: 80,   notes: '' },
  { id: 'ration',   name: 'Emergency ration bar',    brand: 'Datrex',         serving: '1 bar',      servingWeightG: 55,  perPkg: 1,    cal: 200, fat: 8,    sat: 4,    carbs: 30, fiber: 0,    sugar: 14, protein: 2,    sodium: 5,    potassium: null, notes: 'Carried, not planned to eat.' },
]

export const MEALS: ProtoMeal[] = [
  { id: 'breakfast', name: 'Breakfast',     defaultMeal: true,  anchor: 'breakfast', target: { metric: 'cal',     mode: 'floor', value: 500 } },
  { id: 'ontrail',   name: 'On-trail food', defaultMeal: true,  anchor: null,        target: { metric: 'cal',     mode: 'floor', value: 900 } },
  { id: 'dinner',    name: 'Dinner',        defaultMeal: true,  anchor: 'dinner',    target: { metric: 'protein', mode: 'floor', value: 28 } },
  { id: 'recovery',  name: 'Recovery',      defaultMeal: false, anchor: null,        target: { metric: 'cal',     mode: 'floor', value: 250 } },
  { id: 'happy',     name: 'Happy hour',    defaultMeal: false, anchor: null,        target: null },
]

export const DAILY_TARGETS: ProtoDailyTarget[] = [
  { metric: 'cal',       mode: 'band',  min: 3000, max: 4500 },
  { metric: 'protein',   mode: 'floor', value: 90 },
  { metric: 'carbs',     mode: 'band',  min: 350, max: 550 },
  { metric: 'fiber',     mode: 'floor', value: 25 },
  { metric: 'sodium',    mode: 'band',  min: 2000, max: 5000 },
  { metric: 'density',   mode: 'floor', value: 110, unit: 'kcal/oz' },
  { metric: 'potassium', mode: 'off' },
]

const E = (food: string, basis: ProtoEntry['basis'], amt: number): ProtoEntry => ({ food, basis, amt })
export const DAYS: ProtoDay[] = [
  { n: 1, label: 'Day 1', note: 'Trailhead ~2 pm', omit: ['breakfast', 'recovery', 'happy'], meals: {
    ontrail: [E('clif', 'serving', 1), E('trailmix', 'weight', 60), E('tort', 'serving', 2), E('saus', 'weight', 56), E('cheese', 'weight', 56)],
    dinner: [E('strog', 'package', 1), E('oil', 'serving', 1)],
  } },
  { n: 2, label: 'Day 2', note: null, omit: [], meals: {
    breakfast: [E('oats', 'serving', 2), E('coffee', 'serving', 1), E('milk', 'serving', 1)],
    ontrail: [E('probar', 'serving', 1), E('waffle', 'serving', 2), E('lyte', 'serving', 1), E('tort', 'serving', 2), E('tuna', 'package', 1), E('pnut', 'serving', 1)],
    recovery: [E('snick', 'serving', 1)],
    dinner: [E('pasta', 'package', 1), E('oil', 'serving', 1), E('tuna', 'serving', 1)],
    happy: [E('choc', 'serving', 2)],
  } },
  { n: 3, label: 'Day 3', note: null, omit: [], meals: {
    breakfast: [E('oats', 'serving', 2), E('coffee', 'serving', 1)],
    ontrail: [E('clif', 'serving', 1), E('trailmix', 'weight', 45), E('lyte', 'serving', 1), E('tort', 'serving', 2), E('cheese', 'weight', 56), E('saus', 'weight', 56)],
    recovery: [E('probar', 'serving', 1)],
    dinner: [E('beans', 'serving', 2), E('tort', 'serving', 2), E('oil', 'serving', 1)],
    happy: [E('mms', 'serving', 1)],
  } },
  { n: 4, label: 'Day 4', note: 'Summit day', omit: [], meals: {
    breakfast: [E('oats', 'serving', 1), E('coffee', 'serving', 1), E('pnut', 'serving', 1)],
    ontrail: [E('probar', 'serving', 1), E('waffle', 'serving', 2), E('leather', 'serving', 2), E('lyte', 'serving', 1), E('tort', 'serving', 2), E('tuna', 'serving', 1)],
    recovery: [E('snick', 'serving', 1)],
    dinner: [E('strog', 'package', 1), E('oil', 'serving', 1)],
    happy: [E('choc', 'serving', 2)],
  } },
  // Day 5 is the curated "happy path" reference day: every food has complete
  // macros (no coffee/leather), so all six daily targets actually grade, and the
  // amounts land it inside EVERY target - the calorie/protein/carbs/fiber/sodium
  // bands AND the calorie-density floor (~116 kcal/oz vs the 110 floor). It is a
  // realistically dense day (peanut butter in the oatmeal, no watery tuna at
  // dinner). The other full days keep coffee (incomplete macros) so the
  // warning/incomplete states stay visible for testing.
  { n: 5, label: 'Day 5', note: 'Dialed-in day - on-target reference', omit: [], meals: {
    breakfast: [E('oats', 'serving', 2), E('milk', 'serving', 1), E('pnut', 'serving', 1)],
    ontrail: [E('clif', 'serving', 1), E('trailmix', 'weight', 45), E('tort', 'serving', 2), E('saus', 'weight', 56), E('cheese', 'weight', 56)],
    recovery: [E('probar', 'serving', 1), E('snick', 'serving', 1)],
    dinner: [E('pasta', 'package', 1), E('oil', 'serving', 1)],
    happy: [E('mms', 'serving', 1)],
  } },
  { n: 6, label: 'Day 6', note: null, omit: [], meals: {
    breakfast: [E('oats', 'serving', 1), E('coffee', 'serving', 1)],
    ontrail: [E('snick', 'serving', 1), E('trailmix', 'weight', 45), E('lyte', 'serving', 1), E('tort', 'serving', 2), E('tuna', 'package', 1), E('pnut', 'serving', 1)],
    recovery: [E('waffle', 'serving', 2)],
    dinner: [E('beans', 'serving', 2), E('tort', 'serving', 2), E('oil', 'serving', 1)],
    happy: [E('choc', 'serving', 2)],
  } },
  { n: 7, label: 'Day 7', note: 'Hike out by noon', omit: ['dinner', 'recovery', 'happy'], meals: {
    breakfast: [E('oats', 'serving', 2), E('coffee', 'serving', 1)],
    ontrail: [E('clif', 'serving', 1), E('leather', 'serving', 2)],
  } },
]

export const EXTRAS: ProtoEntry[] = [E('ration', 'serving', 1), E('lyte', 'serving', 2), E('coffee', 'serving', 2)]

// Grams per ounce. Matches OZ in the design fixture and the canonical conversion
// behind inputToKcalPerGram (src/food/nutrition-format.ts); inlined to keep this
// module dependency-free and byte-identical to the .mjs for the parity test.
const OZ = 28.3495

// ---- Payload row shapes (snake_case, matching the create_sample_food_plan RPC).
export type SampleFoodRow = {
  id: string; name: string; brand: string | null; serving_description: string | null
  serving_weight_grams: number; calories_per_serving: number; servings_per_package: number | null
  fat_grams: number | null; saturated_fat_grams: number | null; carbs_grams: number | null
  fiber_grams: number | null; sugar_grams: number | null; protein_grams: number | null
  sodium_mg: number | null; potassium_mg: number | null; notes: string | null; sort_order: number
}
export type SampleMealRow = { id: string; name: string; anchor_role: 'breakfast' | 'dinner' | null; is_default: boolean; sort_order: number }
export type SampleDayRow = { id: string; day_type_override: 'full' | 'partial' | null; sort_order: number }
export type SampleDayMealRow = { id: string; day_id: string; meal_id: string }
export type SampleEntryRow = { id: string; day_meal_id: string | null; is_extra: boolean; food_item_id: string; basis: EntryBasis; amount: number; sort_order: number }
export type SampleDailyTargetRow = { id: string; metric: DailyTargetMetric; mode: TargetMode; target_min: number | null; target_max: number | null }
export type SampleMealTargetRow = { id: string; meal_id: string; metric: MealTargetMetric; mode: TargetMode; target_min: number | null; target_max: number | null }
export type SampleFoodPlanPayload = {
  foods: SampleFoodRow[]; meals: SampleMealRow[]; days: SampleDayRow[]; day_meals: SampleDayMealRow[]
  entries: SampleEntryRow[]; daily_targets: SampleDailyTargetRow[]; meal_targets: SampleMealTargetRow[]
}

export type ExistingLibraryFood = { id: string; name: string; brand: string | null; sort_order: number }

const emptyToNull = (s: string): string | null => (s === '' ? null : s)

export function mapBasis(protoBasis: ProtoEntry['basis']): EntryBasis {
  switch (protoBasis) {
    case 'serving': return 'servings'
    case 'package': return 'packages'
    case 'weight': return 'weight'
  }
}

// kcal/oz -> canonical kcal/g (how calorie_density targets are stored).
export function densityKcalPerGram(kcalPerOz: number): number {
  return kcalPerOz / OZ
}

function dailyMetric(metric: ProtoDailyTarget['metric']): DailyTargetMetric | null {
  switch (metric) {
    case 'cal': return 'calories'
    case 'protein': return 'protein'
    case 'carbs': return 'carbs'
    case 'fiber': return 'fiber'
    case 'sodium': return 'sodium'
    case 'density': return 'calorie_density'
    case 'potassium': return null // no production daily metric
  }
}

function mode(m: ProtoDailyTarget['mode']): TargetMode {
  switch (m) {
    case 'band': return 'range'
    case 'floor': return 'min'
    case 'ceiling': return 'max'
    case 'off': return 'off'
  }
}

function bounds(t: { mode: ProtoDailyTarget['mode']; min?: number; max?: number; value?: number }): { target_min: number | null; target_max: number | null } {
  switch (t.mode) {
    case 'band': return { target_min: t.min ?? null, target_max: t.max ?? null }
    case 'floor': return { target_min: t.value ?? null, target_max: null }
    case 'ceiling': return { target_min: null, target_max: t.value ?? null }
    case 'off': return { target_min: null, target_max: null }
  }
}

export function toSampleFoodRow(food: ProtoFood, id: string, sortOrder: number): SampleFoodRow {
  return {
    id,
    sort_order: sortOrder,
    name: food.name,
    brand: emptyToNull(food.brand),
    serving_description: emptyToNull(food.serving),
    serving_weight_grams: food.servingWeightG,
    calories_per_serving: food.cal,
    servings_per_package: food.perPkg,
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

function matchExisting(food: ProtoFood, existing: ExistingLibraryFood[]): ExistingLibraryFood | null {
  const brand = emptyToNull(food.brand)
  return existing.find((e) => e.name === food.name && (e.brand ?? null) === brand) ?? null
}

// Resolve the static dataset into the RPC payload. genId mints client UUIDs
// (randomTempId in production; a deterministic counter in tests). existingFoods
// is the owner's current library, used to reuse matching foods instead of
// cloning them.
export function buildSampleFoodPlanPayload(
  { existingFoods, genId }: { existingFoods: ExistingLibraryFood[]; genId: () => string },
): SampleFoodPlanPayload {
  const startSort = existingFoods.reduce((m, e) => Math.max(m, e.sort_order + 1), 0)
  const foodIdByProto = new Map<string, string>()
  const foods: SampleFoodRow[] = []
  for (const food of FOODS) {
    const hit = matchExisting(food, existingFoods)
    if (hit) {
      foodIdByProto.set(food.id, hit.id)
      continue
    }
    const id = genId()
    foodIdByProto.set(food.id, id)
    foods.push(toSampleFoodRow(food, id, startSort + foods.length))
  }
  const foodIdFor = (proto: string): string => {
    const id = foodIdByProto.get(proto)
    if (!id) throw new Error(`No food id for sample food '${proto}'`)
    return id
  }

  const mealIdByProto = new Map<string, string>()
  const meals: SampleMealRow[] = MEALS.map((m, i) => {
    const id = genId()
    mealIdByProto.set(m.id, id)
    return { id, name: m.name, anchor_role: m.anchor, is_default: m.defaultMeal, sort_order: i }
  })
  const mealIdFor = (proto: string): string => {
    const id = mealIdByProto.get(proto)
    if (!id) throw new Error(`No meal id for sample meal '${proto}'`)
    return id
  }

  const days: SampleDayRow[] = []
  const dayMeals: SampleDayMealRow[] = []
  const entries: SampleEntryRow[] = []
  DAYS.forEach((day, dayIdx) => {
    const dayId = genId()
    days.push({ id: dayId, day_type_override: null, sort_order: dayIdx })
    const scheduled = MEALS.filter((m) => !day.omit.includes(m.id))
    for (const meal of scheduled) {
      const dayMealId = genId()
      dayMeals.push({ id: dayMealId, day_id: dayId, meal_id: mealIdFor(meal.id) })
      const cellEntries = day.meals[meal.id] ?? []
      cellEntries.forEach((e, i) => {
        entries.push({
          id: genId(), day_meal_id: dayMealId, is_extra: false,
          food_item_id: foodIdFor(e.food), basis: mapBasis(e.basis), amount: e.amt, sort_order: i,
        })
      })
    }
  })
  EXTRAS.forEach((e, i) => {
    entries.push({
      id: genId(), day_meal_id: null, is_extra: true,
      food_item_id: foodIdFor(e.food), basis: mapBasis(e.basis), amount: e.amt, sort_order: i,
    })
  })

  const dailyTargets: SampleDailyTargetRow[] = []
  for (const t of DAILY_TARGETS) {
    const metric = dailyMetric(t.metric)
    if (metric === null) continue
    let { target_min, target_max } = bounds(t)
    if (metric === 'calorie_density') {
      target_min = target_min === null ? null : densityKcalPerGram(target_min)
      target_max = target_max === null ? null : densityKcalPerGram(target_max)
    }
    dailyTargets.push({ id: genId(), metric, mode: mode(t.mode), target_min, target_max })
  }

  const mealTargets: SampleMealTargetRow[] = []
  for (const m of MEALS) {
    if (!m.target) continue
    const { target_min, target_max } = bounds(m.target)
    mealTargets.push({
      id: genId(), meal_id: mealIdFor(m.id),
      metric: m.target.metric === 'cal' ? 'calories' : 'protein',
      mode: mode(m.target.mode), target_min, target_max,
    })
  }

  return { foods, meals, days, day_meals: dayMeals, entries, daily_targets: dailyTargets, meal_targets: mealTargets }
}
