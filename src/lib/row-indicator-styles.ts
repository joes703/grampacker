// Canonical tints for the small status/flag indicators that live inside
// rows (worn marker, consumable marker, gear "needs repair" badge, gear
// "loaned out" badge). Worn/consumable are bare row icons; gear statuses
// are soft advisory badges and intentionally keep their original stronger
// badge text for contrast inside the tinted pill.
//
// Tailwind scans for literal class strings, so these MUST be referenced as
// whole tokens (e.g. `WORN_ICON_CLASS`), never composed dynamically into
// variant prefixes like `hover:${WORN_ICON_CLASS}`. RowIconButton's
// toggle variants intentionally keep their `hover:text-purple-600` /
// `hover:text-orange-600` strings literal for that reason; the comment
// there cross-references this file as the source of truth for the hue.

export const WORN_ICON_CLASS = 'text-purple-600'
export const CONSUMABLE_ICON_CLASS = 'text-orange-600'
// Soft pill backgrounds for the gear status badges. These preserve the
// original gear-status treatment while keeping the classes centralized.
export const NEEDS_REPAIR_BADGE_CLASS =
  'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:ring-amber-800/50'
export const LOANED_OUT_BADGE_CLASS =
  'bg-rose-50 text-rose-800 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800/50'
