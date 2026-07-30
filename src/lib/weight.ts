export type WeightUnit = 'g' | 'oz'

const OZ_PER_GRAM = 0.035274 // 1 / 28.3495

// Gear weights carry one decimal place (shared/gear.ts weightGramsSchema is
// the authority; this is the client-side half of the same contract).
const GRAM_DECIMALS = 1
const GRAM_SCALE = 10 ** GRAM_DECIMALS

// Snap a computed gram value onto the stored precision. Every path that
// produces grams from user input or a unit conversion must go through this,
// or it produces a value the server will reject as too precise.
export function roundGrams(grams: number): number {
  return Math.round(grams * GRAM_SCALE) / GRAM_SCALE
}

// Grams as display text: at most one decimal, trailing zeros trimmed, so 240
// reads "240" and 12.4 reads "12.4" - never "12.40".
//
// This is also what keeps float noise off the screen. Individual weights are
// snapped to one decimal, but SUMS are not: 0.1 + 0.2 is 0.30000000000000004,
// and raw interpolation would render exactly that.
export function formatGrams(grams: number): string {
  return String(roundGrams(grams))
}

export function gramsToOz(grams: number): number {
  return grams * OZ_PER_GRAM
}

// Inverse of gramsToOz. Returns an unrounded gram value; callers storing the
// result should pass it through roundGrams to land on the stored precision.
export function ozToGrams(oz: number): number {
  return oz / OZ_PER_GRAM
}

// Individual item weight (oz only, never compound lb+oz). Pass 'g' when the
// caller never toggles units.
export function formatItemWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${formatGrams(grams)} g`
  return `${gramsToOz(grams).toFixed(1)} oz`
}

// Aggregate weight for summary slots (base, total, consumable). Uses
// compound lb+oz in imperial mode once the value crosses 1 lb so big
// numbers stay readable. Distinct from formatItemWeight on purpose: per-
// row oz-only keeps row columns tabular, while a summary stat at 14 kg
// reads as "30 lb 13.8 oz" not "493.8 oz".
export function formatTotalWeight(grams: number, unit: WeightUnit): string {
  if (unit === 'g') return `${formatGrams(grams)} g`
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

// ---------------------------------------------------------------------------
// Public share view unit — DELIBERATELY a separate key.
// ---------------------------------------------------------------------------
// The /r/:slug page is anonymous and may be opened by anyone, including on a
// shared or borrowed browser. It used to drive WEIGHT_UNIT_KEY, the same key
// the authenticated app reads, so a stranger toggling oz on someone's shared
// list silently reconfigured that device's own gear and lists views. No
// account data was ever at risk (the share route is GET-only and there is no
// server-side unit preference), but reconfiguring the owner's app from a public
// page is still wrong.
//
// Isolating it rather than making it ephemeral preserves the behavior the share
// view always documented: the viewer's choice persists on their device. It just
// no longer reaches across into the authenticated app's preference.
//
// These write ONLY the share key. Nothing here may ever call setWeightUnit.
export const SHARE_WEIGHT_UNIT_KEY = 'shareWeightUnit'

export function getShareWeightUnit(): WeightUnit {
  // Same trust-boundary validation as getWeightUnit: localStorage can hold
  // anything. Falls back to the authenticated preference when the share key
  // holds no USABLE value - absent and present-but-unparseable are treated
  // identically on purpose, because neither expresses a viewer preference.
  // (The chain still bottoms out at 'g': getWeightUnit defaults there when its
  // own key is missing or corrupt.) A signed-in owner opening their own share
  // link therefore starts in their usual units - the isolation is one-way,
  // read-through but never write-through.
  const raw = localStorage.getItem(SHARE_WEIGHT_UNIT_KEY)
  if (raw === 'g' || raw === 'oz') return raw
  return getWeightUnit()
}

export function setShareWeightUnit(unit: WeightUnit): void {
  localStorage.setItem(SHARE_WEIGHT_UNIT_KEY, unit)
}
