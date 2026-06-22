// ============================================================================
// THROWAWAY DESIGN-PROTOTYPE DATA + NUTRITION ENGINE
//
// Direct TS port of `docs/design/Grampacker Food Planning/fp/data.jsx` and the
// pure helpers from `fp/store.jsx`. This exists ONLY to drive the read-only
// visual-parity prototype rendered at /lists/:id/food?variant=design-prototype.
//
// NOT production code. No persistence, no Supabase, no queries. Delete this
// whole folder (`src/food/__design-prototype__/`) once the populated-screen
// composition has been folded into the real Food Plan UI. See NOTES.md.
// ============================================================================

export type WeightUnit = 'g' | 'oz'
export type Basis = 'serving' | 'package' | 'weight'
export type NutrientKey =
  | 'cal' | 'fat' | 'sat' | 'carbs' | 'fiber' | 'sugar' | 'protein' | 'sodium' | 'potassium'
export type MetricKey = NutrientKey | 'density' | 'cpr'

export type Food = {
  id: string
  name: string
  brand: string
  serving: string
  servingWeightG: number
  perPkg: number | null
  cal: number
  fat: number | null
  sat: number | null
  carbs: number | null
  fiber: number | null
  sugar: number | null
  protein: number | null
  sodium: number | null
  potassium: number | null
  notes: string
}

export type Entry = { food: string; basis: Basis; amt: number }
export type Day = {
  n: number
  label: string
  note: string | null
  omit: string[]
  fullOverride?: boolean | null
  meals: Record<string, Entry[]>
}
export type MealTarget = {
  metric: NutrientKey
  mode: 'floor' | 'ceiling' | 'band'
  value?: number
  min?: number
  max?: number
  unit: string
}
export type Meal = {
  id: string
  name: string
  defaultMeal?: boolean
  anchor?: boolean
  added?: boolean
  custom?: boolean
  target: MealTarget | null
}
export type DailyTarget = {
  metric: MetricKey
  label: string
  mode: 'band' | 'floor' | 'ceiling' | 'off'
  value?: number
  min?: number
  max?: number
  unit: string
}

// ---- Food library ----------------------------------------------------------
export const FOODS: Food[] = [
  { id:'oats',     name:'Instant oatmeal',         brand:'Quaker',         serving:'1 packet',   servingWeightG:43,  perPkg:1,    cal:150, fat:3,   sat:0.5, carbs:27, fiber:3,    sugar:12, protein:4,   sodium:100,  potassium:130, notes:'Add hot water; doubles as a base for add-ins.' },
  { id:'coffee',   name:'Instant coffee',          brand:'Starbucks Via',  serving:'1 stick',    servingWeightG:2.3, perPkg:1,    cal:5,   fat:null,sat:null,carbs:0,  fiber:0,    sugar:0,  protein:null,sodium:null, potassium:null,notes:'Label only lists calories. Macros unknown.' },
  { id:'milk',     name:'Powdered milk',           brand:'Nido',           serving:'3 tbsp',     servingWeightG:24,  perPkg:8,    cal:80,  fat:0,   sat:0,   carbs:12, fiber:0,    sugar:12, protein:8,   sodium:120,  potassium:380, notes:'' },
  { id:'probar',   name:'Meal bar',                brand:'ProBar',         serving:'1 bar',      servingWeightG:85,  perPkg:1,    cal:370, fat:18,  sat:3,   carbs:44, fiber:5,    sugar:22, protein:9,   sodium:150,  potassium:350, notes:'' },
  { id:'clif',     name:'Energy bar, crunchy PB',  brand:'Clif',           serving:'1 bar',      servingWeightG:68,  perPkg:1,    cal:260, fat:9,   sat:2,   carbs:39, fiber:5,    sugar:17, protein:9,   sodium:200,  potassium:250, notes:'' },
  { id:'trailmix', name:'Trail mix',               brand:'Bulk bin',       serving:'30 g',       servingWeightG:30,  perPkg:null, cal:150, fat:9,   sat:1.5, carbs:14, fiber:2,    sugar:8,  protein:4,   sodium:45,   potassium:160, notes:'Bought by weight - no fixed package.' },
  { id:'pnut',     name:'Peanut butter packet',    brand:"Justin's",       serving:'1 packet',   servingWeightG:32,  perPkg:1,    cal:190, fat:16,  sat:2.5, carbs:7,  fiber:2,    sugar:2,  protein:7,   sodium:65,   potassium:null,notes:'Potassium not on label.' },
  { id:'strog',    name:'Beef stroganoff',         brand:'Mountain House', serving:'1 cup',      servingWeightG:70,  perPkg:2,    cal:250, fat:9,   sat:4,   carbs:32, fiber:2,    sugar:4,  protein:11,  sodium:720,  potassium:300, notes:'Pouch is 2 servings.' },
  { id:'pasta',    name:'Pasta side, alfredo',     brand:'Knorr',          serving:'1/2 pouch',  servingWeightG:61,  perPkg:2,    cal:240, fat:6,   sat:3,   carbs:41, fiber:2,    sugar:3,  protein:8,   sodium:770,  potassium:200, notes:'' },
  { id:'oil',      name:'Olive oil',               brand:'',               serving:'1 tbsp',     servingWeightG:14,  perPkg:null, cal:120, fat:14,  sat:2,   carbs:0,  fiber:0,    sugar:0,  protein:0,   sodium:0,    potassium:0,   notes:'Calorie-dense dinner add.' },
  { id:'tort',     name:'Flour tortilla',          brand:'Mission',        serving:'1 tortilla', servingWeightG:49,  perPkg:8,    cal:140, fat:4,   sat:1.5, carbs:24, fiber:1,    sugar:1,  protein:4,   sodium:350,  potassium:70,  notes:'' },
  { id:'saus',     name:'Summer sausage',          brand:'Hickory Farms',  serving:'28 g',       servingWeightG:28,  perPkg:null, cal:110, fat:10,  sat:4,   carbs:1,  fiber:0,    sugar:0,  protein:5,   sodium:430,  potassium:90,  notes:'Sliced from a chub - entered by weight.' },
  { id:'cheese',   name:'Cheddar cheese',          brand:'Tillamook',      serving:'28 g',       servingWeightG:28,  perPkg:null, cal:110, fat:9,   sat:6,   carbs:1,  fiber:0,    sugar:0,  protein:7,   sodium:180,  potassium:28,  notes:'' },
  { id:'tuna',     name:'Tuna packet',             brand:'StarKist',       serving:'1 pouch',    servingWeightG:74,  perPkg:1,    cal:80,  fat:1,   sat:0,   carbs:0,  fiber:0,    sugar:0,  protein:17,  sodium:230,  potassium:200, notes:'' },
  { id:'beans',    name:'Dehydrated refried beans',brand:'Harmony House',  serving:'1/3 cup',    servingWeightG:35,  perPkg:6,    cal:120, fat:1,   sat:0,   carbs:20, fiber:7,    sugar:1,  protein:7,   sodium:330,  potassium:500, notes:'' },
  { id:'snick',    name:'Chocolate bar',           brand:'Snickers',       serving:'1 bar',      servingWeightG:52,  perPkg:1,    cal:250, fat:12,  sat:4.5, carbs:33, fiber:1,    sugar:27, protein:4,   sodium:120,  potassium:150, notes:'' },
  { id:'waffle',   name:'Energy waffle',           brand:'Honey Stinger',  serving:'1 waffle',   servingWeightG:30,  perPkg:1,    cal:140, fat:6,   sat:2.5, carbs:21, fiber:0,    sugar:9,  protein:1,   sodium:50,   potassium:null,notes:'' },
  { id:'mms',      name:'Peanut candies',          brand:"M&M's",          serving:'1/4 cup',    servingWeightG:40,  perPkg:1,    cal:200, fat:10,  sat:4,   carbs:24, fiber:2,    sugar:21, protein:4,   sodium:20,   potassium:130, notes:'' },
  { id:'lyte',     name:'Electrolyte mix',         brand:'LMNT',           serving:'1 stick',    servingWeightG:6,   perPkg:1,    cal:10,  fat:0,   sat:0,   carbs:2,  fiber:0,    sugar:0,  protein:0,   sodium:1000, potassium:200, notes:'' },
  { id:'leather',  name:'Fruit leather',           brand:'Homemade',       serving:'1 strip',    servingWeightG:15,  perPkg:null, cal:45,  fat:null,sat:null,carbs:11, fiber:null, sugar:9,  protein:null,sodium:null, potassium:null,notes:'Homemade - only calories, carbs and sugar measured.' },
  { id:'choc',     name:'Dark chocolate',          brand:"Lily's",         serving:'2 squares',  servingWeightG:20,  perPkg:5,    cal:110, fat:8,   sat:5,   carbs:9,  fiber:2,    sugar:5,  protein:2,   sodium:5,    potassium:80,  notes:'' },
  { id:'ration',   name:'Emergency ration bar',    brand:'Datrex',         serving:'1 bar',      servingWeightG:55,  perPkg:1,    cal:200, fat:8,   sat:4,   carbs:30, fiber:0,    sugar:14, protein:2,   sodium:5,    potassium:null,notes:'Carried, not planned to eat.' },
]
const FOOD: Record<string, Food> = {}
FOODS.forEach((f) => { FOOD[f.id] = f })

/** Lookup that never returns undefined (the prototype fixture is internally consistent). */
export function food(id: string): Food {
  const f = FOOD[id]
  if (!f) throw new Error(`design-prototype: unknown food id "${id}"`)
  return f
}

// ---- Meal definitions ------------------------------------------------------
export const MEALS: Meal[] = [
  { id:'breakfast', name:'Breakfast',     defaultMeal:true, anchor:true, target:{ metric:'cal',     mode:'floor', value:500, unit:'kcal' } },
  { id:'ontrail',   name:'On-trail food', defaultMeal:true,              target:{ metric:'cal',     mode:'floor', value:900, unit:'kcal' } },
  { id:'dinner',    name:'Dinner',        defaultMeal:true, anchor:true, target:{ metric:'protein', mode:'floor', value:28,  unit:'g' } },
  { id:'recovery',  name:'Recovery',      added:true,                    target:{ metric:'cal',     mode:'floor', value:250, unit:'kcal' } },
  { id:'happy',     name:'Happy hour',    custom:true,                   target:null },
]

// ---- Plan-level daily nutrition targets ------------------------------------
export const DAILY_TARGETS: DailyTarget[] = [
  { metric:'cal',       label:'Calories',        mode:'band',  min:3000, max:4500, unit:'kcal' },
  { metric:'protein',   label:'Protein',         mode:'floor', value:90,  unit:'g' },
  { metric:'carbs',     label:'Carbohydrates',   mode:'band',  min:350, max:550, unit:'g' },
  { metric:'fiber',     label:'Fiber',           mode:'floor', value:25,  unit:'g' },
  { metric:'sodium',    label:'Sodium',          mode:'band',  min:2000, max:5000, unit:'mg' },
  { metric:'density',   label:'Calorie density', mode:'floor', value:125, unit:'kcal/oz' },
  { metric:'potassium', label:'Potassium',       mode:'off',   unit:'mg' },
]

// ---- The 7-day plan --------------------------------------------------------
function E(food: string, basis: Basis, amt: number): Entry { return { food, basis, amt } }
export const DAYS: Day[] = [
  { n:1, label:'Day 1', note:'Trailhead ~2 pm', omit:['breakfast','recovery','happy'], meals:{
    ontrail:[ E('clif','serving',1), E('trailmix','weight',60), E('tort','serving',2), E('saus','weight',56), E('cheese','weight',56) ],
    dinner:[ E('strog','package',1), E('oil','serving',1) ],
  } },
  { n:2, label:'Day 2', note:null, omit:[], meals:{
    breakfast:[ E('oats','serving',2), E('coffee','serving',1), E('milk','serving',1) ],
    ontrail:[ E('probar','serving',1), E('waffle','serving',2), E('lyte','serving',1), E('tort','serving',2), E('tuna','package',1), E('pnut','serving',1) ],
    recovery:[ E('snick','serving',1) ],
    dinner:[ E('pasta','package',1), E('oil','serving',1), E('tuna','serving',1) ],
    happy:[ E('choc','serving',2) ],
  } },
  { n:3, label:'Day 3', note:null, omit:[], meals:{
    breakfast:[ E('oats','serving',2), E('coffee','serving',1) ],
    ontrail:[ E('clif','serving',1), E('trailmix','weight',45), E('lyte','serving',1), E('tort','serving',2), E('cheese','weight',56), E('saus','weight',56) ],
    recovery:[ E('probar','serving',1) ],
    dinner:[ E('beans','serving',2), E('tort','serving',2), E('oil','serving',1) ],
    happy:[ E('mms','serving',1) ],
  } },
  { n:4, label:'Day 4', note:'Summit day', omit:[], meals:{
    breakfast:[ E('oats','serving',1), E('coffee','serving',1), E('pnut','serving',1) ],
    ontrail:[ E('probar','serving',1), E('waffle','serving',2), E('leather','serving',2), E('lyte','serving',1), E('tort','serving',2), E('tuna','serving',1) ],
    recovery:[ E('snick','serving',1) ],
    dinner:[ E('strog','package',1), E('oil','serving',1) ],
    happy:[ E('choc','serving',2) ],
  } },
  { n:5, label:'Day 5', note:null, omit:[], meals:{
    breakfast:[ E('oats','serving',2), E('coffee','serving',1), E('milk','serving',1) ],
    ontrail:[ E('clif','serving',1), E('trailmix','weight',45), E('lyte','serving',1), E('tort','serving',2), E('saus','weight',56), E('cheese','weight',56) ],
    recovery:[ E('probar','serving',1) ],
    dinner:[ E('pasta','package',1), E('tuna','serving',1) ],
    happy:[ E('mms','serving',1) ],
  } },
  { n:6, label:'Day 6', note:null, omit:[], meals:{
    breakfast:[ E('oats','serving',1), E('coffee','serving',1) ],
    ontrail:[ E('snick','serving',1), E('trailmix','weight',45), E('lyte','serving',1), E('tort','serving',2), E('tuna','package',1), E('pnut','serving',1) ],
    recovery:[ E('waffle','serving',2) ],
    dinner:[ E('beans','serving',2), E('tort','serving',2), E('oil','serving',1) ],
    happy:[ E('choc','serving',2) ],
  } },
  { n:7, label:'Day 7', note:'Hike out by noon', omit:['dinner','recovery','happy'], meals:{
    breakfast:[ E('oats','serving',2), E('coffee','serving',1) ],
    ontrail:[ E('clif','serving',1), E('leather','serving',2) ],
  } },
]
export const EXTRAS: Entry[] = [ E('ration','serving',1), E('lyte','serving',2), E('coffee','serving',2) ]

export const PLAN = { listName:'Wind River high route', days:7, isDraft:true } as const

// ============================================================================
// Nutrition engine (pure functions over the fixture above)
// ============================================================================
export const OZ = 28.3495

export function trim(n: number): number { return Number.isInteger(n) ? n : Math.round(n * 10) / 10 }

export function effServings(e: Entry): number {
  const f = food(e.food)
  if (e.basis === 'serving') return e.amt
  if (e.basis === 'package') return e.amt * (f.perPkg || 1)
  if (e.basis === 'weight') return e.amt / f.servingWeightG // amt in grams
  return e.amt
}
export function entryWeightG(e: Entry): number { return effServings(e) * food(e.food).servingWeightG }
export function entryNutrient(e: Entry, key: NutrientKey): number | null {
  const v = food(e.food)[key]
  return v == null ? null : v * effServings(e)
}

// basis label, e.g. "2 servings", "1 pkg - 2 serv", "60 g"
export function basisLabel(e: Entry): string {
  const s = effServings(e)
  if (e.basis === 'serving') return `${trim(e.amt)} ${e.amt === 1 ? 'serving' : 'servings'}`
  if (e.basis === 'package') return `${trim(e.amt)} pkg - ${trim(s)} serv`
  if (e.basis === 'weight') return `${trim(e.amt)} g`
  return ''
}

export type Metric = { complete: boolean; value: number; missing: string[] }

export function aggregate(entries: Entry[], key: NutrientKey): Metric {
  let sum = 0
  const missing: string[] = []
  entries.forEach((e) => {
    const v = entryNutrient(e, key)
    if (v == null) missing.push(food(e.food).name)
    else sum += v
  })
  return { complete: missing.length === 0 && entries.length > 0, value: sum, missing }
}
export function totalWeightG(entries: Entry[]): number { return entries.reduce((s, e) => s + entryWeightG(e), 0) }

export function density(entries: Entry[], unit: WeightUnit): Metric {
  const c = aggregate(entries, 'cal')
  const w = totalWeightG(entries)
  if (!c.complete || w === 0) return { complete: false, value: 0, missing: c.missing }
  const perG = c.value / w
  return { complete: true, value: unit === 'g' ? perG : perG * OZ, missing: [] }
}
export function cpRatio(entries: Entry[]): Metric {
  const c = aggregate(entries, 'carbs')
  const p = aggregate(entries, 'protein')
  if (!c.complete || !p.complete || p.value === 0) return { complete: false, value: 0, missing: [] }
  return { complete: true, value: c.value / p.value, missing: [] }
}
export function computeMetric(entries: Entry[], key: MetricKey, unit: WeightUnit): Metric {
  if (key === 'density') return density(entries, unit)
  if (key === 'cpr') return cpRatio(entries)
  return aggregate(entries, key)
}

// ---- day / plan rollups ----------------------------------------------------
export function dayEntries(day: Day): Entry[] {
  const out: Entry[] = []
  MEALS.forEach((m) => { (day.meals[m.id] ?? []).forEach((e) => out.push(e)) })
  return out
}
export function mealsOnDay(day: Day): Meal[] { return MEALS.filter((m) => !day.omit.includes(m.id)) }
export function omittedMeals(day: Day): Meal[] { return MEALS.filter((m) => day.omit.includes(m.id)) }
export function planDayEntries(): Entry[] {
  const o: Entry[] = []
  DAYS.forEach((d) => dayEntries(d).forEach((e) => o.push(e)))
  return o
}
export function allEntries(): Entry[] { return planDayEntries().concat(EXTRAS) }

// ---- full vs partial day ---------------------------------------------------
function anchorMeals(): Meal[] { return MEALS.filter((m) => m.anchor) }
function isFullDayAuto(day: Day): boolean {
  const a = anchorMeals()
  return a.length > 0 && a.every((m) => !day.omit.includes(m.id))
}
export function isFullDay(day: Day): boolean {
  return day.fullOverride == null ? isFullDayAuto(day) : Boolean(day.fullOverride)
}
export function fullDays(): Day[] { return DAYS.filter((d) => isFullDay(d)) }
export function missingAnchors(day: Day): string[] {
  return anchorMeals().filter((m) => day.omit.includes(m.id)).map((m) => m.name)
}
export function fullDayEntries(): Entry[] {
  const o: Entry[] = []
  fullDays().forEach((d) => dayEntries(d).forEach((e) => o.push(e)))
  return o
}

// ---- schedule counts -------------------------------------------------------
export function scheduleCounts() {
  const per = MEALS.map((m) => ({
    id: m.id,
    name: m.name,
    custom: Boolean(m.custom),
    count: DAYS.filter((d) => !d.omit.includes(m.id)).length,
  }))
  const total = per.reduce((s, m) => s + m.count, 0)
  return { per, total, days: DAYS.length, fullDays: fullDays().length }
}

// ---- formatting ------------------------------------------------------------
export function fmtWeightG(g: number, unit: WeightUnit): string {
  if (unit === 'g') return `${Math.round(g)} g`
  const oz = g / OZ
  if (oz >= 16) { const lb = Math.floor(oz / 16); return `${lb} lb ${(oz - lb * 16).toFixed(1)} oz` }
  return `${oz.toFixed(1)} oz`
}
export function fmtNum(n: number, dp = 0): string {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
export function fmtMetric(key: MetricKey, v: number): string {
  if (key === 'cal') return fmtNum(Math.round(v))
  if (key === 'density') return (Math.round(v * 10) / 10).toFixed(1)
  if (key === 'sodium' || key === 'potassium') return fmtNum(Math.round(v))
  if (key === 'cpr') return (Math.round(v * 10) / 10).toFixed(1)
  return fmtNum(Math.round(v))
}
const UNIT: Record<string, string> = {
  cal:'kcal', fat:'g', sat:'g', carbs:'g', fiber:'g', sugar:'g', protein:'g', sodium:'mg', potassium:'mg', density:'',
}
export function metricUnit(key: MetricKey, weightUnit: WeightUnit): string {
  if (key === 'density') return weightUnit === 'g' ? 'kcal/g' : 'kcal/oz'
  return UNIT[key] ?? ''
}
