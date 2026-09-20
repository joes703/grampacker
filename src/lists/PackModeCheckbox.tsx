import { Check } from 'lucide-react'

type Variant = 'ready' | 'packed'

type Props = {
  variant: Variant
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
  title?: string
  standaloneLabel?: boolean
}

const CHECKED_CLASSES: Record<Variant, string> = {
  ready: 'border-amber-500 bg-amber-500 text-white',
  packed: 'border-blue-500 bg-blue-500 text-white',
}

const FOCUS_CLASSES: Record<Variant, string> = {
  ready: 'peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300',
  packed: 'peer-focus-visible:ring-2 peer-focus-visible:ring-blue-300',
}

export default function PackModeCheckbox({
  variant,
  checked,
  disabled = false,
  onChange,
  ariaLabel,
  title,
  standaloneLabel = false,
}: Props) {
  const control = (
    <>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        title={title}
        className="peer sr-only print:hidden"
      />
      <span
        aria-hidden="true"
        title={title}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors print:hidden ${
          checked ? CHECKED_CLASSES[variant] : 'border-gray-300 bg-white text-transparent'
        } ${FOCUS_CLASSES[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
    </>
  )

  if (standaloneLabel) {
    // print:hidden on the WRAPPER too, not just on `control`: the label is a
    // flex item in its own right, so hiding only its children would leave an
    // empty box still claiming its share of the row's gap - and rows and
    // container headers use different gaps, so the two checkbox columns would
    // stop lining up down the printed page. The blank print squares that
    // stand in for these checkboxes are rendered by the call sites.
    return (
      <label className={`inline-flex shrink-0 print:hidden ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        {control}
      </label>
    )
  }

  return control
}
