import type { FoodPlanBasis } from './food-plans'

// THE canonical food-weight projection (food-planning-design.md section 5). One
// pure function, imported unchanged by the SPA (the plan editor, slice 2b), the
// authenticated list projection and the public share (both slice 3/5). There is
// no second implementation and specifically no SQL re-derivation of the grams
// formula - the old build had exactly that duplication and the two could drift.
//
// Each entry arrives PRE-JOINED to its food's nutrition (design 5.2: the server
// joins food_plan_entries to food_items; the SPA joins against its ['food-items']
// cache), so this fold needs no lookup and no N+1.
export type ProjectionEntry = {
  basis: FoodPlanBasis
  amount: number
  // From the entry's food. serving_weight_grams is NOT NULL > 0 in the schema,
  // so it is always present; servings_per_package is the nullable one.
  servingWeightGrams: number
  servingsPerPackage: number | null
}

export type FoodProjection = {
  // FULL-PRECISION total grams. NOT rounded - callers round exactly once at the
  // boundary via roundProjectedGrams (design 5.6/12.10). Rounding here, or
  // per-entry, is the classic way to get a total that disagrees with itself.
  grams: number
  // True when at least one entry could not be projected and the total is an
  // undercount. This fact must travel with the number everywhere it goes,
  // including the public share (design 5.4). The ONLY incomplete condition is a
  // `packages` entry whose food has a null servings_per_package; `servings` and
  // `weight` are always projectable (serving_weight_grams is NOT NULL > 0).
  incomplete: boolean
}

// Carry full precision through the whole fold; never round an intermediate.
//   servings -> amount * serving_weight_grams
//   packages -> amount * servings_per_package * serving_weight_grams
//   weight   -> amount   (the grams ARE the amount; never divide then multiply)
export function projectFoodGrams(entries: ProjectionEntry[]): FoodProjection {
  let grams = 0
  let incomplete = false
  for (const e of entries) {
    if (e.basis === 'servings') {
      grams += e.amount * e.servingWeightGrams
    } else if (e.basis === 'weight') {
      grams += e.amount
    } else {
      // packages
      if (e.servingsPerPackage === null) {
        incomplete = true
        continue // unprojectable: contributes nothing, flags the total
      }
      grams += e.amount * e.servingsPerPackage * e.servingWeightGrams
    }
  }
  return { grams, incomplete }
}

// The SINGLE rounding site (design 5.6/12.10). Public and authenticated totals
// must round at the SAME site or a share could disagree with the owner's view by
// a gram, so both call this rather than rounding inline. Round the SUM, never the
// per-entry rows.
export function roundProjectedGrams(grams: number): number {
  return Math.round(grams)
}
