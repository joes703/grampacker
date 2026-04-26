export type WeightUnit = 'g' | 'oz'

const OZ_PER_GRAM = 0.035274

export function gramsToOz(grams: number): number {
  return grams * OZ_PER_GRAM
}

// Individual item weight (oz only, never compound lb+oz)
export function formatItemWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${grams} g`
  return `${(gramsToOz(grams)).toFixed(1)} oz`
}

// Summary/total weight (compound lb+oz when >= 1 lb)
export function formatTotalWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${grams} g`
  const oz = gramsToOz(grams)
  if (oz < 16) return `${oz.toFixed(1)} oz`
  const lb = Math.floor(oz / 16)
  const remOz = (oz % 16).toFixed(1)
  return `${lb} lb ${remOz} oz`
}

export function gramsToLbOzParts(grams: number): { lb: number; oz: number } {
  const totalOz = gramsToOz(grams)
  const lb = Math.floor(totalOz / 16)
  const oz = totalOz % 16
  return { lb, oz }
}

export type WeightRollup = {
  totalGrams: number
  wornGrams: number
  consumableGrams: number
  baseGrams: number // total - worn - consumable
}

export function computeWeightRollup(
  items: { weight_grams: number; quantity: number; is_worn: boolean; is_consumable: boolean }[],
): WeightRollup {
  let totalGrams = 0
  let wornGrams = 0
  let consumableGrams = 0

  for (const item of items) {
    const w = item.weight_grams * item.quantity
    totalGrams += w
    if (item.is_worn) wornGrams += w
    else if (item.is_consumable) consumableGrams += w
  }

  return { totalGrams, wornGrams, consumableGrams, baseGrams: totalGrams - wornGrams - consumableGrams }
}

export function getWeightUnit(): WeightUnit {
  return (localStorage.getItem('weightUnit') as WeightUnit) ?? 'g'
}

export function setWeightUnit(unit: WeightUnit): void {
  localStorage.setItem('weightUnit', unit)
}
