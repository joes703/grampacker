export type WeightUnit = 'g' | 'oz'

const OZ_PER_GRAM = 0.035274 // 1 / 28.3495

export function gramsToOz(grams: number): number {
  return grams * OZ_PER_GRAM
}

// Inverse of gramsToOz. Returns a fractional gram value; callers that need
// integer grams (storage / display rounding) should Math.round the result.
export function ozToGrams(oz: number): number {
  return oz / OZ_PER_GRAM
}

// Individual item weight (oz only, never compound lb+oz). Pass 'g' when the
// caller never toggles units.
export function formatItemWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${grams} g`
  return `${gramsToOz(grams).toFixed(1)} oz`
}

export function gramsToLbOzParts(grams: number): { lb: number; oz: number } {
  const totalOz = gramsToOz(grams)
  const lb = Math.floor(totalOz / 16)
  const oz = totalOz % 16
  return { lb, oz }
}

export function getWeightUnit(): WeightUnit {
  return (localStorage.getItem('weightUnit') as WeightUnit) ?? 'g'
}

export function setWeightUnit(unit: WeightUnit): void {
  localStorage.setItem('weightUnit', unit)
}
