import { useState } from 'react'
import type { Category } from '../lib/types'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'

type Props = {
  categories: Category[]
  count: number
  onMove: (categoryId: string | null) => void
  onClose: () => void
}

export default function BulkMoveCategoryDialog({ categories, count, onMove, onClose }: Props) {
  const [selected, setSelected] = useState<string>('')

  const heading = `Move ${count} item${count !== 1 ? 's' : ''} to category`
  return (
    <Modal open onClose={onClose} title={heading} className="w-full max-w-sm">
      <div className="p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4">{heading}</h2>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— Uncategorized —</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <PrimaryButton
            type="button"
            onClick={() => onMove(selected || null)}
          >
            Move
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  )
}
