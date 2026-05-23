import { ClipboardList } from 'lucide-react'

type Props = {
  packMode: boolean
  onTogglePackMode: () => void
}

// Mobile-only pack-mode toggle (lg:hidden). Sits near the top of the list
// page so the toggle stays visible without scrolling. Desktop equivalent
// lives in ListDocumentToolbar alongside list identity.
//
// Pack mode is URL state on a list (?mode=pack), not a separate
// destination — it belongs on the list page itself, not in the global
// mobile bottom bar. The aria-pressed attribute is what screen readers
// use to communicate the toggle state; the visual color change carries
// the same meaning visually.
export default function MobilePackToggle({ packMode, onTogglePackMode }: Props) {
  return (
    <div className="lg:hidden flex items-center print:hidden">
      <button
        type="button"
        onClick={onTogglePackMode}
        title={packMode ? 'Pack mode: on' : 'Pack mode: off'}
        aria-label={packMode ? 'Exit pack mode' : 'Enter pack mode'}
        aria-pressed={packMode}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
          packMode
            ? 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
        }`}
      >
        <ClipboardList size={14} />
        <span>{packMode ? 'Exit pack mode' : 'Pack mode'}</span>
      </button>
    </div>
  )
}
