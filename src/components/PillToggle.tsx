import { type ReactNode } from 'react'

type Props = {
  active: boolean
  onClick: () => void
  /** Visible button text. */
  label: string
  /** Optional leading icon. Caller controls icon sizing. */
  icon?: ReactNode
  /** Accessible name override. Falls back to the visible label. */
  ariaLabel?: string
  /** Tooltip. The pill's state is conveyed by color + aria-pressed; the
   *  title is optional copy the caller can use to add a hint. */
  title?: string
  disabled?: boolean
  /** Layout-only escape hatch (e.g. margins, alignment). Do not use to
   *  restyle the pill's internal padding/colors. */
  className?: string
}

// Pill-shaped toggle button. Rounded border, fills with blue-50/blue-700
// when active, gray border + muted text when idle.
//
// Reserved for page/list mode toggles. Currently the only consumer is
// the Pack mode pill (desktop ListDocumentToolbar + MobilePackToggle).
// Binary on/off settings and in-content view toggles use ToggleSwitch
// instead — see docs/ui-density.md "Toggle Taxonomy" for the rule.
//
// Sizing is fixed (no `size` prop) since one consumer doesn't need
// variation. Reintroduce a size variant when a second consumer arrives.
const PILL_CLASSES = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium'
const ACTIVE_CLASSES = 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
const IDLE_CLASSES = 'border-gray-300 text-gray-600 hover:bg-gray-50'
const DISABLED_CLASSES = 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'

export default function PillToggle({
  active,
  onClick,
  label,
  icon,
  ariaLabel,
  title,
  disabled = false,
  className = '',
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      className={`${PILL_CLASSES} ${active ? ACTIVE_CLASSES : IDLE_CLASSES} ${DISABLED_CLASSES} ${className}`.trim()}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
