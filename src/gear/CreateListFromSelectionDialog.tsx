import { useState } from 'react'
import { X } from 'lucide-react'
import FormLabel from '../components/FormLabel'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'

type Props = {
  selectedCount: number
  existingListCount: number
  saving: boolean
  onSubmit: (name: string, description: string | null) => void
  onClose: () => void
}

export default function CreateListFromSelectionDialog({
  selectedCount,
  existingListCount,
  saving,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const listCapHit = existingListCount >= 100
  const itemCapHit = selectedCount > 300
  const blocked = listCapHit || itemCapHit
  const trimmed = name.trim()
  const canSubmit = !blocked && !saving && trimmed.length > 0

  return (
    <Modal open onClose={onClose} title="Create list from selection" className="w-full max-w-md" closeOnBackdropClick={false}>
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Create list from selection</h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit(trimmed, description.trim() || null) }}
        className="px-6 py-4 space-y-4"
      >
          <p className="text-sm text-gray-600">
            {selectedCount} item{selectedCount === 1 ? '' : 's'} will be added to the new list.
          </p>

          {listCapHit && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              You've reached the 100-list limit. Delete an existing list before creating a new one.
            </p>
          )}
          {itemCapHit && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Lists can hold at most 300 items. You've selected {selectedCount}. Reduce the selection and try again.
            </p>
          )}

          <div>
            <FormLabel htmlFor="cls-name">
              List name
            </FormLabel>
            <input
              id="cls-name"
              autoFocus
              type="text"
              required
              maxLength={256}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <FormLabel htmlFor="cls-desc">
              Description <span className="text-xs font-normal text-gray-400">(optional)</span>
            </FormLabel>
            <textarea
              id="cls-desc"
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <PrimaryButton
              type="submit"
              disabled={!canSubmit}
            >
              {saving ? 'Creating…' : 'Create list'}
            </PrimaryButton>
          </div>
      </form>
    </Modal>
  )
}
