import { useMemo, useState } from 'react'
import Modal from '../components/Modal'
import type { FoodItem } from '../lib/types'
import { FLAT_TABLE_ROW, ROW_CONTROL_TARGET } from '../components/flat-table-styles'

export default function FoodPicker({
  foods, onPick, onClose,
}: {
  foods: FoodItem[]
  onPick: (food: FoodItem) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return foods
    return foods.filter((f) => f.name.toLowerCase().includes(needle) || (f.brand ?? '').toLowerCase().includes(needle))
  }, [foods, q])

  return (
    <Modal open onClose={onClose} title="Add food" className="w-[calc(100vw-2rem)] max-w-md max-h-[80vh] overflow-hidden">
      <div className="flex max-h-[80vh] flex-col">
        <div className="px-4 pt-4 pb-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your food library"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
          {filtered.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">No matching food.</p>
          ) : (
            filtered.map((f) => (
              <button key={f.id} type="button" onClick={() => onPick(f)}
                className={`${FLAT_TABLE_ROW} ${ROW_CONTROL_TARGET} flex w-full items-center justify-between text-left`}>
                <span className="min-w-0 truncate text-sm text-gray-900">{f.name}</span>
                {f.brand ? <span className="ml-2 truncate text-xs text-gray-400">{f.brand}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
