// Canonical "Wind River high route" sample dataset for the Food Plan smoke-test
// seed. A faithful ASCII port of the Claude Design study fixture at
// `docs/design/Grampacker Food Planning/fp/data.jsx` (em dashes -> " - ", curly
// quotes -> straight, multiplication signs -> x). This module is PURE DATA only:
// the prototype's field names (cal/perPkg/servingWeightG/serving/basis 'serving'
// |'package'|'weight') are preserved here and translated to production DB columns
// by `food-design-sample-map.mjs`. null = genuinely unknown (NEVER stored as 0);
// 0 = a measured zero (e.g. olive oil sodium). Do not "tidy" nulls into zeros.

// ---- Food library (22 items) ---------------------------------------------
export const FOODS = [
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

// ---- Meal definitions (plan-level) ---------------------------------------
// Breakfast / On-trail food / Dinner are product defaults; Breakfast + Dinner
// are anchors (their presence makes a day "full"). Recovery is owner-added (not
// a default); Happy hour is a custom meal. `target` mirrors the design fixture:
// {metric, mode:'floor'|'ceiling'|'band', value | min/max}. Array order is the
// production sort_order.
export const MEALS = [
  { id: 'breakfast', name: 'Breakfast',     defaultMeal: true,  anchor: 'breakfast', target: { metric: 'cal',     mode: 'floor', value: 500 } },
  { id: 'ontrail',   name: 'On-trail food', defaultMeal: true,  anchor: null,        target: { metric: 'cal',     mode: 'floor', value: 900 } },
  { id: 'dinner',    name: 'Dinner',        defaultMeal: true,  anchor: 'dinner',    target: { metric: 'protein', mode: 'floor', value: 28 } },
  { id: 'recovery',  name: 'Recovery',      defaultMeal: false, anchor: null,        target: { metric: 'cal',     mode: 'floor', value: 250 } },
  { id: 'happy',     name: 'Happy hour',    defaultMeal: false, anchor: null,        target: null },
]

// ---- Plan-level daily nutrition targets ----------------------------------
// Potassium is intentionally listed here (it is in the design fixture) but has
// NO production daily-target metric, so the mapper drops it. density is in
// kcal/oz here; the mapper converts to the canonical kcal/g the DB stores.
export const DAILY_TARGETS = [
  { metric: 'cal',       mode: 'band',  min: 3000, max: 4500 },
  { metric: 'protein',   mode: 'floor', value: 90 },
  { metric: 'carbs',     mode: 'band',  min: 350, max: 550 },
  { metric: 'fiber',     mode: 'floor', value: 25 },
  { metric: 'sodium',    mode: 'band',  min: 2000, max: 5000 },
  { metric: 'density',   mode: 'floor', value: 110, unit: 'kcal/oz' },
  { metric: 'potassium', mode: 'off' },
]

// ---- The 7-day plan ------------------------------------------------------
// A day's scheduled meals = MEALS minus `omit`. No day sets a manual
// full/partial override, so the app derives it: Day 1 (no Breakfast) and Day 7
// (no Dinner) are partial; Days 2-6 are full. entry: {food, basis, amt}.
const E = (food, basis, amt) => ({ food, basis, amt })
export const DAYS = [
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
  // macros (no coffee/leather) so all six daily targets grade, and the amounts
  // land it inside every target including the calorie-density floor
  // (~116 kcal/oz vs the 110 floor). Kept byte-identical to sample-plan.ts.
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

// ---- Extras: packed but not assigned to a Day/Meal -----------------------
export const EXTRAS = [E('ration', 'serving', 1), E('lyte', 'serving', 2), E('coffee', 'serving', 2)]

export const PLAN = { listName: 'Wind River high route', days: 7 }
