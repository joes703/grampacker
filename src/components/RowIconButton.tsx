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
  ref?: Ref<HTMLButtonElement>
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>

const BASE = 'shrink-0 w-7 h-6 inline-flex items-center justify-center rounded'

const VARIANT_CLASSES: Record<Variant, string> = {
  default: 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
  danger: 'text-gray-400 hover:text-red-600 hover:bg-red-50',
  success: 'text-green-600 hover:text-green-700 hover:bg-green-50',
  purpleToggle: 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
  orangeToggle: 'text-gray-400 hover:text-gray-700 hover:bg-gray-100',
  dragHandle: 'cursor-grab touch-none text-gray-400 hover:text-gray-600 active:cursor-grabbing',
}

const ACTIVE_CLASSES: Partial<Record<Variant, string>> = {
  purpleToggle: 'bg-purple-100 text-purple-700',
  orangeToggle: 'bg-orange-100 text-orange-700',
}

export default function RowIconButton({
  icon,
  ariaLabel,
  variant = 'default',
  active = false,
  type = 'button',
  className = '',
  ref,
  ...rest
}: Props) {
  const stateClass = active && ACTIVE_CLASSES[variant] ? ACTIVE_CLASSES[variant]! : VARIANT_CLASSES[variant]
  return (
    <button
      ref={ref}
      type={type}
      aria-label={ariaLabel}
      className={`${BASE} ${stateClass} ${className}`.trim()}
      {...rest}
    >
      {icon}
    </button>
  )
}
