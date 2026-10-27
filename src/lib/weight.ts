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
// The number of a per-row weight, without its unit: grams as formatGrams,
// ounces to one decimal.
export function formatItemWeightNumber(grams: number, unit: WeightUnit): string {
  return unit === 'g' ? formatGrams(grams) : gramsToOz(grams).toFixed(1)
}

export function formatItemWeight(grams: number, unit: WeightUnit): string {
  return `${formatItemWeightNumber(grams, unit)} ${unit}`
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

// localStorage THROWS (not just fails) in Safari private mode and with site
// data blocked. The unit is read on every page that shows a weight, so reads
// fall back to the default and writes are ignored.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage is blocked: the unit stays at its default.
  }
}

export function getWeightUnit(): WeightUnit {
  // localStorage is a trust boundary — anything could be in there. Validate
  // explicitly and fall back to the default for null, missing, or any
  // unexpected string.
  const raw = readStorage(WEIGHT_UNIT_KEY)
  return raw === 'g' || raw === 'oz' ? raw : 'g'
}

export function setWeightUnit(unit: WeightUnit): void {
  writeStorage(WEIGHT_UNIT_KEY, unit)
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
// shared or borrowed browser. If it used WEIGHT_UNIT_KEY, the key the
// authenticated app reads, a stranger toggling oz on someone's shared list would
// silently reconfigure that device's own gear and lists views. No account data
// is at risk (the share route is GET-only and there is no server-side unit
// preference), but reconfiguring the owner's app from a public page is wrong.
//
// A separate key rather than an ephemeral one: the viewer's choice persists on
// their device, without reaching into the authenticated app's preference.
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
  const raw = readStorage(SHARE_WEIGHT_UNIT_KEY)
  if (raw === 'g' || raw === 'oz') return raw
  return getWeightUnit()
}

export function setShareWeightUnit(unit: WeightUnit): void {
  writeStorage(SHARE_WEIGHT_UNIT_KEY, unit)
}
