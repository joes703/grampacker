import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { fetchFoodPlanCopyOptions, queryKeys, type FoodPlanCopyOption } from '../lib/queries'

export default function CopyFoodPlanDialog({
  userId,
  targetListId,
  copying = false,
  onCopy,
  onClose,
}: {
  userId: string
  targetListId: string
  copying?: boolean
  onCopy: (sourceFoodPlanId: string) => void
  onClose: () => void
}) {
  const optionsQuery = useQuery({
    queryKey: queryKeys.foodPlanCopyOptions(userId, targetListId),
    queryFn: () => fetchFoodPlanCopyOptions(userId, targetListId),
  })
  const options = optionsQuery.data ?? []
  const [selected, setSelected] = useState('')
  const selectedFoodPlanId = options.some((option) => option.food_plan_id === selected)
    ? selected
    : options[0]?.food_plan_id ?? ''

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!selectedFoodPlanId || copying) return
    onCopy(selectedFoodPlanId)
  }

  return (
    <Modal open onClose={onClose} title="Copy an existing food plan" className="w-[calc(100vw-2rem)] max-w-md">
      <form onSubmit={submit} className="p-6">
        <h2 className="text-base font-semibold text-gray-900">Copy an existing food plan</h2>
        <p className="mt-1 text-sm text-gray-600">
          Copies days, meals, food entries, and targets into this list. The new plan is independent; edits will not sync back.
        </p>

        {optionsQuery.isLoading ? (
          <p className="mt-4 text-sm text-gray-500">Loading your food plans...</p>
        ) : optionsQuery.isError ? (
          <div className="mt-4">
            <p className="text-sm text-gray-700">Couldn't load your food plans.</p>
            <button type="button" onClick={() => optionsQuery.refetch()} className="mt-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Try again
            </button>
          </div>
        ) : options.length === 0 ? (
          <p className="mt-4 text-sm text-gray-600">No other food plans to copy yet.</p>
        ) : (
          <label className="mt-4 block text-sm font-medium text-gray-700">
            Food plan to copy
            <select
              value={selectedFoodPlanId}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
            >
              {options.map((option) => (
                <option key={option.food_plan_id} value={option.food_plan_id}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={copying || !selectedFoodPlanId || options.length === 0 || optionsQuery.isError}>
            {copying ? 'Copying...' : 'Copy food plan'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}

function optionLabel(option: FoodPlanCopyOption): string {
  return option.list_name
}
