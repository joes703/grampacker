import { type ReactNode } from 'react'

type Size = 'sm' | 'md'

type Props = {
  active: boolean
  onClick: () => void
  /** Visible button text. */
  label: string
  /** Optional leading icon. Caller controls icon sizing — semantically
   *  different icons (ClipboardList 14 vs CheckSquare 12) stay each
   *  surface's call. */
  icon?: ReactNode
  /** md: page-level mode toggle (e.g. Pack mode in the list toolbar).
   *  sm: inline view/filter inside a panel (e.g. Show unpacked only,
   *      Ready checks inside PackingProgress). */
  size?: Size
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
// when active, gray border + muted text when idle. The visible affordance
// for mode and view toggles on the content surface.
//
// Toggle taxonomy (see docs/ui-density.md "Toggle Taxonomy"):
//   - PillToggle ........... mode/view toggles on content (this one)
//   - ToggleSwitch ......... persistent settings in a settings panel
//   - RowIconButton ........ per-row tag flags (Worn, Consumable)
//   - UnitSegmentedControl . mutually exclusive option selection
//   - MobileBottomBar item . nav active-state
//
// State semantics: aria-pressed carries the on/off meaning for assistive
// tech. The blue active fill carries it visually. The label itself stays
// the same in both states (callers pass static label text); flipping
// label copy is a per-site decision, not built in here.
const SIZE_CLASSES: Record<Size, string> = {
  md: 'gap-1.5 px-3 py-1.5 text-sm',
  sm: 'gap-1 px-3 py-1 text-xs',
}

const ACTIVE_CLASSES = 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
const IDLE_CLASSES = 'border-gray-300 text-gray-600 hover:bg-gray-50'
const DISABLED_CLASSES = 'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'

export default function PillToggle({
  active,
  onClick,
  label,
  icon,
  size = 'md',
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
      className={`inline-flex items-center rounded-lg border font-medium ${SIZE_CLASSES[size]} ${active ? ACTIVE_CLASSES : IDLE_CLASSES} ${DISABLED_CLASSES} ${className}`.trim()}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
