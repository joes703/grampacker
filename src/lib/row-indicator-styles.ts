// Canonical tints for the small status/flag indicators that live inside
// rows (worn marker, consumable marker, gear "needs repair" badge, gear
// "loaned out" badge). All four hues live at the same 600-level weight so
// the indicators read as a coordinated family across editable rows, pack
// mode, share view, and the gear library.
//
// Tailwind scans for literal class strings, so these MUST be referenced as
// whole tokens (e.g. `WORN_ICON_CLASS`), never composed dynamically into
// variant prefixes like `hover:${WORN_ICON_CLASS}`. RowIconButton's
// toggle variants intentionally keep their `hover:text-purple-600` /
// `hover:text-orange-600` strings literal for that reason; the comment
// there cross-references this file as the source of truth for the hue.

export const WORN_ICON_CLASS = 'text-purple-600'
export const CONSUMABLE_ICON_CLASS = 'text-orange-600'
export const NEEDS_REPAIR_ICON_CLASS = 'text-amber-600'
export const LOANED_OUT_ICON_CLASS = 'text-rose-600'

// Soft pill backgrounds for the gear status badges. Icon tint is the
// matching *_ICON_CLASS above; the badge wrapper adds the tinted bg + ring
// so the two surfaces (icon and chip) share a single palette.
export const NEEDS_REPAIR_BADGE_CLASS =
  'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
export const LOANED_OUT_BADGE_CLASS =
  'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
