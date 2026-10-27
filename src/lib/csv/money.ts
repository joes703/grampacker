// Money parsing for CSV import, shared by the gear-library and list
// importers. It lives in its own leaf module so the two paths cannot drift:
// the hardening below was written for gear, and a copy-paste into list.ts
// would have started diverging the first time either was touched.

// What counts as currency decoration around a price: any Unicode currency
// SYMBOL (\p{Sc} covers $ £ € ¥ ₹ and the rest), whitespace including the
// NBSP / narrow-NBSP some locales use as a group separator, and an ISO 4217
// code - matched as ANY three ASCII letters rather than a hand-kept list,
// which would silently blank the cost on any export using a code the list
// happened to omit (AED, THB, RUB...).
//
// Three letters exactly, deliberately NOT "any letters": the word "minus"
// must not be strippable, or "minus $5" imports as a positive 5.
import { MAX_COST } from '../../../shared/gear'

const CURRENCY_DECORATION = String.raw`(?:\p{Sc}|\s|[A-Za-z]{3})`


// Empty/whitespace cells become null (gifts and unknown values stay
// unknown, never coerced to 0). Negative or unparseable inputs also
// drop to null rather than corrupting the row.
//
// Money arrives written as money: "$12.99", "1,299.00", "USD 42.50".
// Bare parseFloat returns NaN for a leading currency symbol, so every
// priced row would import blank - and blank is indistinguishable from
// "the user left cost empty", so nobody would notice. We strip
// currency decoration, then validate STRICTLY: parseFloat is too lenient
// to be the gate on its own ('12.99.5' -> 12.99, '12,99' -> 12, both
// silently wrong rather than rejected).
function parseCost(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null

  // Strip RECOGNIZED currency decoration from the ends. An allowlist, not
  // a denylist: stripping whatever we failed to recognize is how a sign
  // gets silently deleted. "-$5" (U+2212) and its lookalikes U+207B,
  // U+208B, U+2796, the word "minus", accounting parens "($5)" - each one
  // is a NEGATIVE that becomes a confident positive 5 the moment we treat
  // an unknown character as noise. Enumerating them is whack-a-mole, so
  // anything not matched here survives into the strict gate below and is
  // rejected there. Same protection for non-ASCII digits (JS \d is ASCII
  // only, so Arabic-Indic "١٢.99" must not strip down to ".99").
  //
  // Ends only, never a global strip: removing junk from the middle would
  // JOIN digits that were separated, turning "1e3" into 13 and "12abc34"
  // into 1234 - numbers that were never in the file.
  const s = trimmed
    .replace(new RegExp(`^${CURRENCY_DECORATION}+`, 'iu'), '')
    .replace(new RegExp(`${CURRENCY_DECORATION}+$`, 'iu'), '')
  if (!s) return null

  // Commas: thousands-shaped groups strip; anything else is ambiguous
  // (is "12,99" twelve-ninety-nine, or one-two-nine-nine?) and drops to
  // null. Same stance as parseIsoDate - silent ambiguity is worse than
  // rejecting, and here the wrong guess is a wrong price.
  let n = s
  if (n.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(n)) return null
    n = n.replaceAll(',', '')
  }

  // Strict shape gate: digits with an optional decimal part on either side
  // of the point. ".5" and "5." are both accepted on purpose.
  if (!/^(\d+\.?\d*|\.\d+)$/.test(n)) return null
  const parsedValue = parseFloat(n)
  if (!isFinite(parsedValue) || parsedValue < 0) return null

  // Over the schema's max, DROP the value instead of saturating to the cap:
  // clamping invents a price the file never contained and it looks entirely
  // legitimate in the UI. Null keeps the row importable - the point of
  // handling this client-side is that one unusable cell must not 400 the
  // whole atomic import - without asserting a made-up number.
  //
  // Checked BEFORE rounding, or the rounding re-introduces the saturation
  // it was meant to remove: 99999999.9901 rounds down onto the cap exactly.
  // costSchema's .max() is inclusive, so the cap itself must still pass.
  if (parsedValue > MAX_COST) return null
  // Round to cents; the cost DTO (shared/gear.ts costSchema) rejects extra
  // precision.
  return Math.round(parsedValue * 100) / 100
}

// Which column a money value came from, because the two carry different
// semantics for zero:
//
//   'cost'  - grampacker's own column. 0 means the item is genuinely FREE.
//   'price' - Lighterpack's column. 0 means UNSET, not free. Lighterpack
//             defaults an unpriced item to 0, and older grampacker list
//             exports wrote price=0 for every row. Reading those zeros as
//             real would invent data: a whole inventory imported as
//             costing nothing.
//
// So a 0 in a `price` column resolves to null. A genuinely free item is
// expressible through the `cost` column, which is what our exports
// emit. The tradeoff is that a real Lighterpack $0 item cannot be
// distinguished from an unpriced one - accepted, because guessing "free"
// on a fabricated zero is the damaging direction.
export type MoneyColumnKind = 'cost' | 'price'

export function parseCostFromColumn(
  raw: string | undefined,
  kind: MoneyColumnKind,
): number | null {
  const value = parseCost(raw)
  if (kind === 'price' && value === 0) return null
  return value
}
