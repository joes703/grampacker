type Props = {
  checked: boolean
  onChange: () => void
  ariaLabel?: string
  /** When true, fires no onChange and renders muted. Native `disabled`
   *  attribute is what blocks activation; the opacity treatment matches
   *  the codebase's other disabled-button surfaces. */
  disabled?: boolean
}

// Compact iOS-style switch. Canonical control for binary on/off toggles
// across the app — settings panels (Group worn items, public-link
// sharing) AND in-content view toggles (Show unpacked only, Ready
// checks inside PackingProgress). Single source of truth so the
// surfaces never drift on size, color, or transition feel.
//
// See docs/ui-density.md "Toggle Taxonomy" for when to use this vs
// PillToggle vs RowIconButton vs UnitSegmentedControl.
export default function ToggleSwitch({ checked, onChange, ariaLabel, disabled = false }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      disabled={disabled}
      // focus-visible (not bare focus) so a tap on touch — which the
      // <dialog> autofocus inherits when the modal opens by tap — does
      // NOT render the keyboard focus ring. Keyboard Tab still shows
      // the ring because the browser's focus-visible heuristic stays
      // true through programmatic focus that follows keyboard input.
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
