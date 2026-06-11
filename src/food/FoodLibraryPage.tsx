import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X, Download } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import { useDocumentTitle } from '../lib/use-document-title'
import {
  queryKeys,
  fetchFoodItems,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  nextFoodItemSortOrder,
  assertFoodItemWithinCap,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  type FoodItemInput,
} from '../lib/queries'
import { showToast } from '../lib/toast'
import { foodItemsToCsv, downloadCsv } from '../lib/csv'
import { FLAT_TABLE_SURFACE, FLAT_TABLE_HEADER } from '../components/flat-table-styles'
import PrimaryButton from '../components/PrimaryButton'
import Modal from '../components/Modal'
import FoodItemRow from './FoodItemRow'
import FoodItemDialog from './FoodItemDialog'
import type { FoodItem } from '../lib/types'

type DialogState =
  | { type: 'create' }
  | { type: 'edit'; item: FoodItem }
  | { type: 'delete'; item: FoodItem; returnDialog?: DialogState }

export default function FoodLibraryPage() {
  useDocumentTitle('Food')
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const { data: allItems = [], isLoading } = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: () => fetchFoodItems(userId),
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems
    const q = search.toLowerCase()
    return allItems.filter(
      (f) => f.name.toLowerCase().includes(q) || (f.brand ?? '').toLowerCase().includes(q),
    )
  }, [allItems, search])

  const addItem = useMutation({
    mutationFn: (patch: FoodItemInput) =>
      createFoodItem(userId, patch, nextFoodItemSortOrder(allItems)),
    ...makeOptimisticInsert<FoodItem, FoodItemInput>({
      qc,
      queryKey: queryKeys.foodItems(),
      optimistic: (patch) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        sort_order: nextFoodItemSortOrder(allItems),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...patch,
      }),
      merge: (curr, next) => [...curr, next].sort((a, b) => a.name.localeCompare(b.name)),
      errorToast: "Couldn't add that food. Please try again.",
    }),
  })

  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FoodItemInput> }) =>
      updateFoodItem(id, patch),
    ...makeOptimisticUpdate<FoodItem, { id: string; patch: Partial<FoodItemInput> }>({
      qc,
      queryKey: queryKeys.foodItems(),
      id: ({ id }) => id,
      apply: (food, { patch }) => ({ ...food, ...patch }),
      errorToast: "Couldn't save that food. Please try again.",
    }),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => deleteFoodItem(id),
    ...makeOptimisticDelete<FoodItem, string>({
      qc,
      queryKey: queryKeys.foodItems(),
      id: (id) => id,
      errorToast: "Couldn't delete that food. Please try again.",
    }),
  })

  function handleSave(patch: FoodItemInput) {
    if (dialog?.type === 'edit') {
      editItem.mutate({ id: dialog.item.id, patch }, { onSuccess: () => setDialog(null) })
      return
    }
    try {
      assertFoodItemWithinCap(allItems)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Your food library is full.', { type: 'error' })
      return
    }
    addItem.mutate(patch, { onSuccess: () => setDialog(null) })
  }

  function handleExport() {
    downloadCsv('food-library.csv', foodItemsToCsv(allItems))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Food</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            disabled={allItems.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <Download size={15} />
            <span className="sr-only sm:not-sr-only">Export</span>
          </button>
          <PrimaryButton type="button" onClick={() => setDialog({ type: 'create' })}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={16} />
              Add food
            </span>
          </PrimaryButton>
        </div>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search foods by name or brand"
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-9 text-sm focus:border-gray-400 focus:outline-none"
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-500">Loading your food library...</p>
      ) : allItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-sm text-gray-600">Your food library is empty.</p>
          <button
            type="button"
            onClick={() => setDialog({ type: 'create' })}
            className="mt-2 text-sm font-medium text-gray-900 underline"
          >
            Add your first food
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No foods match "{search}".</p>
      ) : (
        <div className={FLAT_TABLE_SURFACE}>
          <div className={`${FLAT_TABLE_HEADER} px-3`}>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {filtered.length} food{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          {filtered.map((food) => (
            <FoodItemRow
              key={food.id}
              food={food}
              onEdit={(f) => setDialog({ type: 'edit', item: f })}
              onDelete={(f) => setDialog({ type: 'delete', item: f })}
            />
          ))}
        </div>
      )}

      {(dialog?.type === 'create' || dialog?.type === 'edit') && (
        <FoodItemDialog
          key={dialog.type === 'edit' ? dialog.item.id : 'new'}
          item={dialog.type === 'edit' ? dialog.item : undefined}
          saving={addItem.isPending || editItem.isPending}
          onClose={() => setDialog(null)}
          onSave={handleSave}
          onDeleteFromInventory={
            dialog.type === 'edit'
              ? () => setDialog({ type: 'delete', item: dialog.item, returnDialog: dialog })
              : undefined
          }
        />
      )}

      {dialog?.type === 'delete' && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title="Delete from inventory"
          className="w-[calc(100vw-2rem)] max-w-sm"
        >
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900">Delete from inventory</h2>
            <p className="mt-2 text-sm text-gray-600">
              Delete "{dialog.item.name}" from your food library? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  removeItem.mutate(dialog.item.id)
                  setDialog(null)
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
