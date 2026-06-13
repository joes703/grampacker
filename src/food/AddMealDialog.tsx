import { useState, type FormEvent } from 'react'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { MEAL_NAME_MAX } from '../lib/caps'

export default function AddMealDialog({
  saving = false, onSave, onClose,
}: {
  saving?: boolean
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const canSave = name.trim().length > 0
  function submit(e: FormEvent) {
    e.preventDefault()
    if (canSave) onSave(name.trim().slice(0, MEAL_NAME_MAX))
  }
  return (
    <Modal open onClose={onClose} title="Add meal" className="w-[calc(100vw-2rem)] max-w-sm">
      <form onSubmit={submit} className="space-y-4 p-6">
        <h2 className="text-base font-semibold text-gray-900">Add meal</h2>
        <label className="block text-sm font-medium text-gray-700">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={MEAL_NAME_MAX} placeholder="e.g. Lunch"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">Cancel</button>
          <PrimaryButton type="submit" disabled={saving || !canSave}>{saving ? 'Adding...' : 'Add meal'}</PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
