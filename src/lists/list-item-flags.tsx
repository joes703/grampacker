import { Shirt, UtensilsCrossed } from 'lucide-react'

// Single source of truth for the Worn / Consumable row-flag icons. Used
// by ItemRow (pack-mode and desktop read-only fallbacks) and MobileRowBody
// (single-slot mobile indicator). The editable toggle buttons in
// ItemRow's desktop branch render plain <Shirt /> / <UtensilsCrossed />
// inside RowIconButton; RowIconButton's purpleToggle / orangeToggle
// active variants share the SAME text-purple-600 / text-orange-600
// colors so all four code paths land on identical hue, weight, and size.
//
// Constants are exported for the rare case (toolbars, badges) where a
// component wrapper isn't appropriate. Don't introduce new colors for
// these flags — drift here is exactly the problem this file exists to
// prevent.

export const WORN_TEXT_CLASS = 'text-purple-600'
export const CONSUMABLE_TEXT_CLASS = 'text-orange-600'

const DEFAULT_SIZE = 14

export function WornIcon({
  size = DEFAULT_SIZE,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <Shirt
      size={size}
      aria-label="Worn"
      className={`${WORN_TEXT_CLASS} ${className}`.trim()}
    />
  )
}

export function ConsumableIcon({
  size = DEFAULT_SIZE,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <UtensilsCrossed
      size={size}
      aria-label="Consumable"
      className={`${CONSUMABLE_TEXT_CLASS} ${className}`.trim()}
    />
  )
}
