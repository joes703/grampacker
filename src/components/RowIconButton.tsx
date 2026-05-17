import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'

// Single shared component for the small icon buttons that live inside a row
// (item-row toggles, kebabs, drag handles, gear-row edit/delete, category-
// header actions, etc.). Canonical sizing is w-7 h-6 (28×24) so every row
// has a consistent click-target floor and matching column geometry.
//
// Pick a variant; the variant owns idle + hover styling. For toggles, set
// `active` to render the chip-background "on" state. Pass dnd-kit listeners
// / attributes via spread (they go through to the underlying <button>).
//
// Out of scope: toolbar buttons (border + larger padding), modal close
// buttons, link-styled buttons. These are not row-level.

type Variant =
  | 'default'        // muted gray, gray hover bg
  | 'danger'         // muted gray idle, red text + red hover bg
  | 'success'        // green idle, deeper green hover bg (rename commit)
  | 'purpleToggle'   // worn marker; chip when active, default when not
  | 'orangeToggle'   // consumable marker; same shape as purpleToggle
  | 'dragHandle'     // cursor-grab + touch-none; idle/hover gray

type Props = {
  icon: ReactNode
  ariaLabel: string
  variant?: Variant
  active?: boolean
  /** Defeat the toggle variants' hover-reveal. Used by form rows
   *  (e.g. AddItemRow) where the inactive flag toggles must always be
   *  visible because there's no parent row hover affordance to reveal
   *  them. No-op for variants whose idle state is already always-visible. */
  alwaysVisible?: boolean
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>

const BASE = 'shrink-0 w-7 h-6 inline-flex items-center justify-center rounded'

const VARIANT_CLASSES: Record<Variant, string> = {
  default: 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
  danger: 'text-gray-400 hover:text-red-600 hover:bg-red-50',
  success: 'text-green-600 hover:text-green-700 hover:bg-green-50',
  purpleToggle:
    'text-gray-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-purple-600 hover:bg-gray-100',
  orangeToggle:
    'text-gray-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-orange-600 hover:bg-gray-100',
  dragHandle: 'cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing',
}

// Active worn/consumable buttons render as icon-only color, matching the
// static read-only sites. The text-purple-600 / text-orange-600 / hover
// strings above are duplicated literally because Tailwind only scans for
// whole class tokens; do NOT replace them with `hover:${WORN_ICON_CLASS}`
// or similar. Source of truth for the hue values: lib/row-indicator-styles
// (WORN_ICON_CLASS, CONSUMABLE_ICON_CLASS). No active background: pack
// mode, share view, mobile, and editable normal view should all read as
// the same simple tinted icon.
const ACTIVE_CLASSES: Partial<Record<Variant, string>> = {
  purpleToggle: 'text-purple-600 hover:bg-gray-100',
  orangeToggle: 'text-orange-600 hover:bg-gray-100',
}

export default function RowIconButton({
  icon,
  ariaLabel,
  variant = 'default',
  active = false,
  alwaysVisible = false,
  type = 'button',
  className = '',
  ref,
  ...rest
}: Props) {
  const stateClass = (active ? ACTIVE_CLASSES[variant] : undefined) ?? VARIANT_CLASSES[variant]
  // opacity-100 wins over the variant's opacity-0 via CSS source order
  // (Tailwind orders numeric utilities by value), but ordering aside the
  // explicit prop keeps consumers from reaching past the API to defeat
  // the hover-reveal with a magic className string.
  const visibilityClass = alwaysVisible ? 'opacity-100' : ''
  return (
    <button
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      className={`${BASE} ${stateClass} ${visibilityClass} ${className}`.trim()}
      {...rest}
    >
      {icon}
    </button>
  )
}
