import { useState, useEffect, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import Modal from '../components/Modal'

type Props = {
  categories: Category[]
  item?: GearItem
  defaultCategoryId?: string | null
  onSave: (data: {
    name: string
    description: string | null
    weight_grams: number
    category_id: string | null
  }) => void
  onClose: () => void
  saving?: boolean
}

export default function GearItemDialog({
  categories,
  item,
  defaultCategoryId = null,
  onSave,
  onClose,
  saving = false,
}: Props) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [weightInput, setWeightInput] = useState(String(item?.weight_grams ?? 0))
  const [categoryId, setCategoryId] = useState<string | null>(
    item?.category_id ?? defaultCategoryId,
  )

  useEffect(() => {
    // Reset form when item changes (e.g. switching between edit targets)
    setName(item?.name ?? '')
    setDescription(item?.description ?? '')
    setWeightInput(String(item?.weight_grams ?? 0))
    setCategoryId(item?.category_id ?? defaultCategoryId)
  }, [item, defaultCategoryId])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const weight = parseInt(weightInput, 10)
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      weight_grams: isNaN(weight) || weight < 0 ? 0 : Math.min(weight, 100000),
      category_id: categoryId,
    })
  }

  const isEdit = Boolean(item)

  const heading = isEdit ? 'Edit item' : 'New item'
  return (
    <Modal open onClose={onClose} title={heading} className="w-full max-w-md" closeOnBackdropClick={false}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">{heading}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="gi-name" className="block text-sm font-medium text-gray-700 mb-1">
              Name
            </label>
            <input
              id="gi-name"
              type="text"
              required
              maxLength={256}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="gi-desc" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="gi-desc"
              maxLength={2000}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-4">
            <div className="w-32">
              <label htmlFor="gi-weight" className="block text-sm font-medium text-gray-700 mb-1">
                Weight (g)
              </label>
              <input
                id="gi-weight"
                type="number"
                min={0}
                max={100000}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="gi-cat" className="block text-sm font-medium text-gray-700 mb-1">
                Category
              </label>
              <select
                id="gi-cat"
                value={categoryId ?? ''}
                onChange={(e) => setCategoryId(e.target.value || null)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Uncategorised —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add item'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
