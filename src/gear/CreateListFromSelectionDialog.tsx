import { useState } from 'react'
import { X } from 'lucide-react'
import FormLabel from '../components/FormLabel'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { FORM_INPUT, ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import { LIST_CAP, LIST_ITEM_CAP, MAX_NAME_LENGTH, MAX_DESC_LENGTH } from '../lib/caps'

type Props = {
  selectedCount: number
  existingListCount: number
  saving: boolean
  onSubmit: (name: string, description: string | null) => void
  onClose: () => void
  /** Save-time error from the parent, rendered inline. This dialog stays open on
   *  failure, and it is a modal - a native <dialog> in the browser's top layer -
   *  so a toast raised behind it would never be seen. Same contract as
   *  GearItemDialog's `saveError`; see src/lib/mutation-error-handler.ts. */
  saveError?: string | null
}

export default function CreateListFromSelectionDialog({
  selectedCount,
  existingListCount,
  saving,
  onSubmit,
  onClose,
  saveError = null,
}: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const listCapHit = existingListCount >= LIST_CAP
  const itemCapHit = selectedCount > LIST_ITEM_CAP
  const blocked = listCapHit || itemCapHit
  const trimmed = name.trim()
  const canSubmit = !blocked && !saving && trimmed.length > 0

  return (
    <Modal open onClose={onClose} title="Create list from selection" className="w-full max-w-md" closeOnBackdropClick={false}>
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">Create list from selection</h2>
        <button type="button" onClick={onClose} aria-label="Close" className={`${ROW_CONTROL_TARGET} text-gray-500 hover:text-gray-600`}>
          <X size={18} />
        </button>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (canSubmit) onSubmit(trimmed, description.trim() || null) }}
      >
        {/* Frozen for the duration of the create, for the same reason as
            GearItemDialog's body: without it the fields stay live while the
            request is out, so anything typed after Create is in state the
            submitted payload never saw - and a success navigates away and
            discards it. Cancel sits inside the fieldset here (unlike the gear
            dialog, whose footer is outside the scroll region), so it is
            disabled too; the X in the header remains the way out.
            min-w-0 because a <fieldset> carries a UA min-inline-size. */}
        <fieldset
          disabled={saving}
          className="min-w-0 px-6 py-4 space-y-4 disabled:opacity-60"
        >
          <p className="text-sm text-gray-600">
            {selectedCount} item{selectedCount === 1 ? '' : 's'} will be added to the new list.
          </p>

          {listCapHit && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              You've reached the {LIST_CAP}-list limit. Delete an existing list before creating a new one.
            </p>
          )}
          {itemCapHit && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              Lists can hold at most {LIST_ITEM_CAP} items. You've selected {selectedCount}. Reduce the selection and try again.
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
              maxLength={MAX_NAME_LENGTH}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full ${FORM_INPUT}`}
            />
          </div>

          <div>
            <FormLabel htmlFor="cls-desc">
              Description <span className="text-xs font-normal text-gray-500">(optional)</span>
            </FormLabel>
            <textarea
              id="cls-desc"
              maxLength={MAX_DESC_LENGTH}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`w-full ${FORM_INPUT} resize-none`}
            />
          </div>

          {saveError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {saveError}
            </div>
          )}

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
        </fieldset>
      </form>
    </Modal>
  )
}
