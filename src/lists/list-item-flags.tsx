import { Shirt, UtensilsCrossed } from 'lucide-react'
import { CONSUMABLE_ICON_CLASS, WORN_ICON_CLASS } from '../lib/row-indicator-styles'

// Single source of truth for the Worn / Consumable row-flag icons. Used
// by ItemRow (pack-mode and desktop read-only fallbacks) and MobileRowBody
// (single-slot mobile indicator). The editable toggle buttons in
// ItemRow's desktop branch render plain <Shirt /> / <UtensilsCrossed />
// inside RowIconButton; RowIconButton's purpleToggle / orangeToggle
// active variants share the SAME text-purple-600 / text-orange-600
// colors (canonicalized in row-indicator-styles.ts) so all four code
// paths land on identical hue, weight, and size.

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
      className={`${WORN_ICON_CLASS} ${className}`.trim()}
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
      className={`${CONSUMABLE_ICON_CLASS} ${className}`.trim()}
    />
  )
}
