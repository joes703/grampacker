import { useState } from 'react'

type Props = {
  title: string
  message: string
  confirmPhrase: string // user must type this exactly to enable confirm
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function TypedConfirmDialog({
  title,
  message,
  confirmPhrase,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState('')
  const matches = typed === confirmPhrase

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold text-gray-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-600 mb-3">{message}</p>
        <p className="text-xs text-gray-500 mb-1">
          Type <span className="font-mono font-semibold text-gray-700">{confirmPhrase}</span> to confirm:
        </p>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches) onConfirm() }}
          className="mb-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
