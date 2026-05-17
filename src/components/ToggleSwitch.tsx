type Props = {
  checked: boolean
  onChange: () => void
  ariaLabel?: string
}

// Compact iOS-style switch used in List options for Group worn items and the
// public-link toggle inside Sharing. Single source of truth so the two
// surfaces never drift on size, color, or transition feel. Previously each
// settings panel kept its own copy.
export default function ToggleSwitch({ checked, onChange, ariaLabel }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
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
