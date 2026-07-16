import { useState, type FormEvent } from 'react'
import { createFoodPlanRequestSchema } from '../../shared/food-plans'
import { FOOD_PLAN_DAY_CAP, MAX_NAME_LENGTH } from '../lib/caps'
import FormLabel from '../components/FormLabel'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'

type Props = {
  onCreate: (input: { name: string; days: number }) => void
  onClose: () => void
  saving?: boolean
  saveError?: string | null
}

// New-plan dialog: a name and a day count. The server seeds the meals and the
// full day x meal grid, so this is the whole create form. Days defaults to 3
// (the schema default) and is clamped to the day cap.
export default function CreatePlanDialog({
  onCreate,
  onClose,
  saving = false,
  saveError = null,
}: Props) {
  const [name, setName] = useState('')
  const [days, setDays] = useState('3')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const parsed = createFoodPlanRequestSchema.safeParse({
      name,
      days: days.trim() === '' ? undefined : Number(days),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form and try again.')
      return
    }
    setError(null)
    onCreate({ name: parsed.data.name, days: parsed.data.days })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New plan"
      className="w-full max-w-sm"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="p-6" noValidate>
        <h2 className="text-base font-semibold text-gray-900">New plan</h2>

        <div className="mt-4">
          <FormLabel htmlFor="plan-name">Name</FormLabel>
          <input
            id="plan-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            placeholder="e.g. JMT resupply"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4">
          <FormLabel htmlFor="plan-days">Days</FormLabel>
          <input
            id="plan-days"
            type="text"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mt-1 w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            1 to {FOOD_PLAN_DAY_CAP}. You can add or remove days later.
          </p>
        </div>

        {(error ?? saveError) && (
          <p className="mt-4 text-sm text-red-600">{error ?? saveError}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <PrimaryButton type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create plan'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
