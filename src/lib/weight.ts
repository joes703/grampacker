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

// Aggregate weight for summary slots (base, total, consumable). Uses
// compound lb+oz in imperial mode once the value crosses 1 lb so big
// numbers stay readable. Distinct from formatItemWeight on purpose: per-
// row oz-only keeps row columns tabular, while a summary stat at 14 kg
// reads as "30 lb 13.8 oz" not "493.8 oz".
export function formatTotalWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${grams} g`
  const { lb, oz } = gramsToLbOzParts(grams)
  if (lb > 0) return `${lb} lb ${oz.toFixed(1)} oz`
  return `${oz.toFixed(1)} oz`
}

export function gramsToLbOzParts(grams: number): { lb: number; oz: number } {
  const totalOz = gramsToOz(grams)
  const lb = Math.floor(totalOz / 16)
  const oz = totalOz % 16
  return { lb, oz }
}

// Same-tab broadcast event. The browser's `storage` event only fires in OTHER
// tabs that share the localStorage origin, so without this dispatch a toggle
// in NavBar would update its own component but not the simultaneously-mounted
// ListDetailPage, GearLibraryPage, or SharePage. The hook
// (use-weight-unit.ts) subscribes to both `storage` (cross-tab) and this
// custom event (same-tab).
export const WEIGHT_UNIT_EVENT = 'weight-unit-change'
export const WEIGHT_UNIT_KEY = 'weightUnit'

export function getWeightUnit(): WeightUnit {
  // localStorage is a trust boundary — anything could be in there. Validate
  // explicitly and fall back to the default for null, missing, or any
  // unexpected string.
  const raw = localStorage.getItem(WEIGHT_UNIT_KEY)
  return raw === 'g' || raw === 'oz' ? raw : 'g'
}

export function setWeightUnit(unit: WeightUnit): void {
  localStorage.setItem(WEIGHT_UNIT_KEY, unit)
  // Notify same-tab subscribers. Cross-tab updates ride the native `storage`
  // event automatically — no manual dispatch needed there.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(WEIGHT_UNIT_EVENT))
  }
}
