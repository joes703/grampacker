import { X } from 'lucide-react'
import Modal from './Modal'

type Props = {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

// Shared shell for the mobile "Options" modals (List options, Gear
// options, and any future surface-specific option panels). Centralizes
// the title + close-X header pattern so the two action bars don't
// drift on padding, spacing, or close-affordance placement.
//
// The wrapped Modal still owns dialog semantics (Escape, backdrop, focus
// redirect); this component just gives every options modal the same
// header chrome and content padding. Children control their own row
// layout — short option lists (Gear options) use list-of-buttons,
// embedded panels (List options) render ListSettingsPanel directly.
export default function MobileOptionsModal({ open, onClose, title, children }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} className="w-full max-w-sm">
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-400 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </Modal>
  )
}
