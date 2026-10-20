import Modal from './Modal'
import { SECONDARY_BUTTON } from './flat-table-styles'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
  dangerous?: boolean
  /** False drops the Cancel button: the one-button acknowledgement variant
   *  (e.g. an import error with nothing to confirm or abort). Escape and
   *  the backdrop still dismiss through onCancel, so pass the same handler
   *  to both. */
  cancel?: boolean
  /** 'danger' renders the message in red - for acknowledgements whose body
   *  IS the error text. */
  messageTone?: 'neutral' | 'danger'
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
  dangerous = false,
  cancel = true,
  messageTone = 'neutral',
}: Props) {
  return (
    <Modal open onClose={onCancel} title={title} className="w-full max-w-sm">
      <div className="p-6">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <p className={`mt-2 text-sm ${messageTone === 'danger' ? 'text-red-600' : 'text-gray-600'}`}>
          {message}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          {cancel && (
            <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              dangerous ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
