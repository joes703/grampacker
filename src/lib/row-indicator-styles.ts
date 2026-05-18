// Canonical tints for the small indicators that live inside rows. Worn and
// consumable are bare row icons; gear statuses are soft advisory badges. Keep
// these as separate visual systems: forcing every indicator into the same
// color weight made the status badges look muddy and caused drift across
// Gear Library, Gear Picker, and List rows.
//
// Tailwind scans for literal class strings, so these MUST be referenced as
// whole tokens (e.g. `WORN_ICON_CLASS`), never composed dynamically into
// variant prefixes like `hover:${WORN_ICON_CLASS}`. RowIconButton's
// toggle variants intentionally keep their `hover:text-purple-600` /
// `hover:text-orange-600` strings literal for that reason; the comment
// there cross-references this file as the source of truth for the hue.

export const WORN_ICON_CLASS = 'text-purple-600'
export const CONSUMABLE_ICON_CLASS = 'text-orange-600'

// Soft pill backgrounds for gear status badges. These intentionally preserve
// the original stronger text-on-tint treatment.
export const NEEDS_REPAIR_BADGE_CLASS =
  'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
export const LOANED_OUT_BADGE_CLASS =
  'bg-rose-50 text-rose-800 ring-1 ring-rose-200'
