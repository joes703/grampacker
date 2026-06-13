import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../components/Modal'
import { createFoodItem, queryKeys, nextFoodItemSortOrder, type FoodItemInput } from '../lib/queries'
import type { FoodItem } from '../lib/types'
import { FLAT_TABLE_ROW, ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import FoodItemDialog from './FoodItemDialog'

type PickerTab = 'recent' | 'inPlan' | 'az'

const TABS: { id: PickerTab; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'inPlan', label: 'In this plan' },
  { id: 'az', label: 'A-Z' },
]

export default function FoodPicker({
  foods, usedFoodIds, userId, onPick, onClose,
}: {
  foods: FoodItem[]
  usedFoodIds: Set<string>
  userId: string
  onPick: (food: FoodItem) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<PickerTab>('recent')
  const [q, setQ] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()

  const createMut = useMutation({
    mutationFn: (patch: FoodItemInput) => createFoodItem(userId, patch, nextFoodItemSortOrder(foods)),
    meta: { errorToast: "Couldn't add the food. Please try again." },
    onSuccess: (created) => {
      setShowCreate(false)
      qc.invalidateQueries({ queryKey: queryKeys.foodItems() })
      onPick(created)
    },
  })

  const tabFoods = useMemo(() => {
    switch (tab) {
      case 'recent':
        return [...foods].sort((a, b) => b.created_at.localeCompare(a.created_at))
      case 'inPlan':
        return foods.filter((f) => usedFoodIds.has(f.id))
      case 'az':
        return [...foods].sort((a, b) => a.name.localeCompare(b.name))
    }
  }, [foods, tab, usedFoodIds])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return tabFoods
    return tabFoods.filter((f) => f.name.toLowerCase().includes(needle) || (f.brand ?? '').toLowerCase().includes(needle))
  }, [tabFoods, q])

  return (
    <Modal open onClose={onClose} title="Add food" className="w-[calc(100vw-2rem)] max-w-md max-h-[80vh] overflow-hidden">
      <div className="flex max-h-[80vh] flex-col">
        <div className="flex items-center justify-between px-4 pt-4">
          <div className="flex gap-3">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`pb-1 text-sm ${tab === t.id ? 'border-b-2 border-emerald-600 font-semibold text-gray-900' : 'text-gray-500'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setShowCreate(true)}
            className="rounded-lg px-2 py-1 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
            + New food
          </button>
        </div>
        <div className="px-4 pt-2 pb-2">
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
      {showCreate ? (
        <FoodItemDialog
          saving={createMut.isPending}
          onSave={(patch) => createMut.mutate(patch)}
          onClose={() => setShowCreate(false)}
        />
      ) : null}
    </Modal>
  )
}
