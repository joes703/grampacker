import { type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react'
import { ROW_CONTROL_TARGET, ROW_DRAG_HANDLE_TARGET } from './flat-table-styles'

// Single shared component for the small icon buttons that live inside a row
// (item-row toggles, kebabs, drag handles, gear-row edit/delete, category-
// header actions, etc.). The compact default is w-7 h-6 (28x24) for controls
// that render only on desktop. Set `touchSafe` on any control that can render
// below lg to use the shared 40px touch / 28px pointer target.
//
// Pick a variant; the variant owns idle + hover styling. For toggles, set
// `active` to render the chip-background "on" state. Pass dnd-kit listeners
// / attributes via spread (they go through to the underlying <button>).
//
// Out of scope: toolbar buttons (border + larger padding) and link-styled
// buttons. These are not row-level.

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
  touchSafe?: boolean
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>

const BASE = 'shrink-0 w-7 h-6 inline-flex items-center justify-center rounded'
const TOUCH_BASE = `shrink-0 ${ROW_CONTROL_TARGET}`
// Drag handles keep the touch box on mobile but narrow on desktop: the grip
// glyph is a ~6px column of dots, so a square box strands visible dead space
// either side of it. Derived from the variant rather than a new prop - every
// dragHandle wants this and nothing else does, so a prop would only create a
// way to get it wrong.
const TOUCH_BASE_DRAG = `shrink-0 ${ROW_DRAG_HANDLE_TARGET}`

const VARIANT_CLASSES: Record<Variant, string> = {
  default: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
  danger: 'text-gray-500 hover:text-red-600 hover:bg-red-50',
  success: 'text-green-600 hover:text-green-700 hover:bg-green-50',
  purpleToggle:
    'text-gray-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-purple-600 hover:bg-gray-100',
  orangeToggle:
    'text-gray-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-orange-600 hover:bg-gray-100',
  dragHandle: 'cursor-grab touch-none text-gray-500 hover:text-gray-600 active:cursor-grabbing',
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
  touchSafe = false,
  type = 'button',
  className = '',
  ref,
  ...rest
}: Props) {
  const stateClass = (active ? ACTIVE_CLASSES[variant] : undefined) ?? VARIANT_CLASSES[variant]
  const touchBase = variant === 'dragHandle' ? TOUCH_BASE_DRAG : TOUCH_BASE
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
      className={`${touchSafe ? touchBase : BASE} ${stateClass} ${visibilityClass} ${className}`.trim()}
      {...rest}
    >
      {icon}
    </button>
  )
}
