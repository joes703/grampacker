import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  queryKeys,
  fetchFoodPlan,
  fetchFoodItems,
} from '../lib/queries'
import type { FoodPlanUsedBy, Meal } from '../../shared/food-plans'
import { ApiError } from '../lib/api'
import { showToast } from '../lib/toast'
import { useDocumentTitle } from '../lib/use-document-title'
import { useWeightUnit } from '../lib/use-weight-unit'
import { formatItemWeight } from '../lib/weight'
import { FOOD_PLAN_DAY_CAP, MAX_NAME_LENGTH } from '../lib/caps'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import FormLabel from '../components/FormLabel'
import ConfirmDialog from '../components/ConfirmDialog'
import TotalWeightValue from '../components/TotalWeightValue'
import {
  selectFoodPlanView,
  describeEntryAmount,
  type PlanCellView,
  type PlanDayView,
  type PlanEntryView,
  type PlanExtrasView,
} from './plan-view'
import { AddEntryDialog, EditEntryDialog } from './EntryDialog'
import { useFoodPlanEditorActions } from './use-food-plan-editor-actions'

// Where a new entry is going: a specific cell, or the Extras pile.
type EntryTarget =
  | { kind: 'cell'; dayMealId: string; label: string }
  | { kind: 'extras'; label: string }

type Dialog =
  | { type: 'rename' }
  | { type: 'addMeal' }
  | { type: 'addEntry'; target: EntryTarget }
  | { type: 'editEntry'; entry: PlanEntryView }
  | { type: 'deleteEntry'; entry: PlanEntryView }
  | { type: 'deleteDay'; day: PlanDayView }
  | { type: 'deleteMeal'; meal: Meal }

function apiMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ApiError) return err.message
  return 'Something went wrong. Please try again.'
}

export default function FoodPlanEditor() {
  const { id } = useParams()

  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(id),
    queryFn: () => fetchFoodPlan(id as string),
    enabled: Boolean(id),
  })
  const { data: foods = [] } = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: fetchFoodItems,
  })

  const actions = useFoodPlanEditorActions(id ?? '')
  const { weightUnit } = useWeightUnit()
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const doc = planQuery.data
  const view = doc ? selectFoodPlanView(doc, foods) : null
  useDocumentTitle(view ? view.name : 'Plan')

  if (planQuery.isLoading) {
    return <p className="text-sm text-gray-500">Loading…</p>
  }
  if (!view) {
    const notFound =
      planQuery.error instanceof ApiError && planQuery.error.status === 404
    return (
      <div>
        <BackLink />
        <p className="mt-4 text-sm text-red-600">
          {notFound
            ? "This plan doesn't exist (it may have been deleted)."
            : "Couldn't load this plan. Refresh the page and try again."}
        </p>
      </div>
    )
  }

  const atDayCap = view.days.length >= FOOD_PLAN_DAY_CAP

  // Serialize plan writes (food-planning-design.md 6/12.3, and the 2a note that
  // 2b serializes structural mutations). Every mutation returns the whole plan
  // document and blindly writes it into the cache; two in flight at once can land
  // out of order and clobber the newer document with an older snapshot. So while
  // ANY mutation is pending, every write TRIGGER is disabled - a single user does
  // one edit at a time. (Dialog-hosted mutations are already exclusive: a native
  // modal blocks the background. The one live gap is that a background button -
  // e.g. Add day - stays clickable while another mutation runs; `busy` closes
  // it.)
  const busy =
    actions.rename.isPending ||
    actions.addDay.isPending ||
    actions.removeDay.isPending ||
    actions.addMeal.isPending ||
    actions.removeMeal.isPending ||
    actions.addEntry.isPending ||
    actions.updateEntry.isPending ||
    actions.removeEntry.isPending ||
    actions.setDayType.isPending

  // Structural mutations have no dialog to host their error, so they toast.
  function runStructural(promise: Promise<unknown>, fallback: string) {
    void promise.catch((err) => showToast(apiMessage(err) ?? fallback, { type: 'error' }))
  }

  return (
    <div className="pb-4">
      <BackLink />

      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-xl font-semibold text-gray-900">
            {view.name}
          </h1>
          <button
            type="button"
            onClick={() => setDialog({ type: 'rename' })}
            disabled={busy}
            aria-label="Rename plan"
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
          >
            <Pencil size={15} />
          </button>
        </div>

        <div className="flex items-center gap-2 text-right">
          <div>
            <div className="text-lg font-semibold tabular-nums text-gray-900">
              <TotalWeightValue grams={view.totalGrams} unit={weightUnit} />
            </div>
            <div className="text-xs text-gray-500">food weight</div>
          </div>
          {view.incomplete && <IncompleteBadge />}
        </div>
      </div>

      {doc?.usedByList && <UsedByBreadcrumb list={doc.usedByList} />}

      <MealBar
        meals={view.meals}
        onAddMeal={() => setDialog({ type: 'addMeal' })}
        onRemoveMeal={(meal) => setDialog({ type: 'deleteMeal', meal })}
        busy={busy}
      />

      <div className="mt-4 flex flex-col gap-3">
        {view.days.map((day) => (
          <DaySection
            key={day.id}
            day={day}
            unit={weightUnit}
            busy={busy}
            onAddFood={(cell) =>
              setDialog({
                type: 'addEntry',
                target: {
                  kind: 'cell',
                  dayMealId: cell.dayMealId,
                  label: `Day ${day.index} · ${cell.mealName}`,
                },
              })
            }
            onEditEntry={(entry) => setDialog({ type: 'editEntry', entry })}
            onDeleteEntry={(entry) => setDialog({ type: 'deleteEntry', entry })}
            onRemoveDay={() => setDialog({ type: 'deleteDay', day })}
            onSetDayType={(override) =>
              runStructural(
                actions.setDayType.mutateAsync({
                  dayId: day.id,
                  dayTypeOverride: override,
                }),
                "Couldn't change the day type.",
              )
            }
          />
        ))}

        <ExtrasSection
          extras={view.extras}
          unit={weightUnit}
          busy={busy}
          onAddFood={() =>
            setDialog({
              type: 'addEntry',
              target: { kind: 'extras', label: 'Extras' },
            })
          }
          onEditEntry={(entry) => setDialog({ type: 'editEntry', entry })}
          onDeleteEntry={(entry) => setDialog({ type: 'deleteEntry', entry })}
        />
      </div>

      <div className="mt-4">
        <button
          type="button"
          disabled={atDayCap || busy}
          onClick={() =>
            runStructural(actions.addDay.mutateAsync(), "Couldn't add a day.")
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <CalendarPlus size={15} />
          {actions.addDay.isPending ? 'Adding day…' : 'Add day'}
        </button>
        {atDayCap && (
          <p className="mt-1 text-xs text-gray-500">
            You&apos;ve reached the {FOOD_PLAN_DAY_CAP}-day limit.
          </p>
        )}
      </div>

      {/* --------------------------------------------------------- dialogs */}

      {dialog?.type === 'rename' && (
        <NameDialog
          title="Rename plan"
          label="Name"
          initialValue={view.name}
          submitLabel="Save"
          saving={actions.rename.isPending}
          saveError={apiMessage(actions.rename.error)}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            actions.rename.mutate(name, { onSuccess: () => setDialog(null) })
          }
        />
      )}

      {dialog?.type === 'addMeal' && (
        <NameDialog
          title="Add meal"
          label="Meal name"
          initialValue=""
          submitLabel="Add meal"
          saving={actions.addMeal.isPending}
          saveError={apiMessage(actions.addMeal.error)}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            actions.addMeal.mutate(name, { onSuccess: () => setDialog(null) })
          }
        />
      )}

      {dialog?.type === 'addEntry' && (
        <AddEntryDialog
          targetLabel={dialog.target.label}
          foods={foods}
          saving={actions.addEntry.isPending}
          saveError={apiMessage(actions.addEntry.error)}
          onClose={() => setDialog(null)}
          onAdd={(input) => {
            const target = dialog.target
            actions.addEntry.mutate(
              target.kind === 'cell'
                ? { ...input, dayMealId: target.dayMealId, isExtra: false }
                : { ...input, dayMealId: null, isExtra: true },
              { onSuccess: () => setDialog(null) },
            )
          }}
        />
      )}

      {dialog?.type === 'editEntry' && dialog.entry.food && (
        <EditEntryDialog
          food={dialog.entry.food}
          basis={dialog.entry.basis}
          amount={dialog.entry.amount}
          saving={actions.updateEntry.isPending}
          saveError={apiMessage(actions.updateEntry.error)}
          onClose={() => setDialog(null)}
          onSave={(patch) =>
            actions.updateEntry.mutate(
              { entryId: dialog.entry.id, patch },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      )}

      {dialog?.type === 'deleteEntry' && (
        <ConfirmDialog
          title="Remove food"
          message={`Remove "${dialog.entry.food?.name ?? 'this food'}" from the plan?`}
          confirmLabel="Remove"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            runStructural(
              actions.removeEntry.mutateAsync(dialog.entry.id),
              "Couldn't remove the food.",
            )
            setDialog(null)
          }}
        />
      )}

      {dialog?.type === 'deleteDay' && (
        <ConfirmDialog
          title={`Delete Day ${dialog.day.index}`}
          message="This removes the day and everything scheduled on it. This cannot be undone."
          confirmLabel="Delete day"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            runStructural(
              actions.removeDay.mutateAsync(dialog.day.id),
              "Couldn't delete the day.",
            )
            setDialog(null)
          }}
        />
      )}

      {dialog?.type === 'deleteMeal' && (
        <ConfirmDialog
          title={`Delete ${dialog.meal.name}`}
          message="This removes the meal from every day, along with any food in it. This cannot be undone."
          confirmLabel="Delete meal"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            runStructural(
              actions.removeMeal.mutateAsync(dialog.meal.id),
              "Couldn't delete the meal.",
            )
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/food/plans"
      className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
    >
      <ArrowLeft size={15} />
      Plans
    </Link>
  )
}

// One plan per trip: at most one list references this plan, and editing here
// changes exactly that trip - which is worth a quiet breadcrumb, not a
// warning (the pre-2026-07-16 shared-plan warning is gone with the model
// that made it necessary). Plans backing no list render nothing.
function UsedByBreadcrumb({ list }: { list: FoodPlanUsedBy }) {
  return (
    <p className="mt-2 text-xs text-gray-500">
      Used by{' '}
      <Link
        to={`/lists/${list.id}`}
        className="font-medium text-gray-600 underline hover:text-gray-800"
      >
        {list.name}
      </Link>
    </p>
  )
}

function IncompleteBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
      title="Some items don't have enough info to weigh (a food with no package size used by the package), so the total is an underestimate."
    >
      <AlertTriangle size={12} />
      Estimate
    </span>
  )
}

function MealBar({
  meals,
  onAddMeal,
  onRemoveMeal,
  busy,
}: {
  meals: Meal[]
  onAddMeal: () => void
  onRemoveMeal: (meal: Meal) => void
  busy: boolean
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Meals
      </span>
      {meals.map((meal) => (
        <span
          key={meal.id}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white py-1 pl-3 pr-1 text-sm text-gray-700"
        >
          {meal.name}
          <button
            type="button"
            onClick={() => onRemoveMeal(meal)}
            disabled={busy}
            aria-label={`Delete ${meal.name}`}
            className="rounded-full p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            <X size={13} />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={onAddMeal}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-800 disabled:opacity-50"
      >
        <Plus size={13} />
        Add meal
      </button>
    </div>
  )
}

function DaySection({
  day,
  unit,
  busy,
  onAddFood,
  onEditEntry,
  onDeleteEntry,
  onRemoveDay,
  onSetDayType,
}: {
  day: PlanDayView
  unit: 'g' | 'oz'
  busy: boolean
  onAddFood: (cell: PlanCellView) => void
  onEditEntry: (entry: PlanEntryView) => void
  onDeleteEntry: (entry: PlanEntryView) => void
  onRemoveDay: () => void
  onSetDayType: (override: 'full' | 'partial' | null) => void
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Day {day.index}</h2>
          {day.dayType === 'partial' && (
            <span
              className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
              title="Daily targets are shown as neutral reference on a partial day. Meal targets are still checked."
            >
              Partial day
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Auto derives full/partial from whether every anchor meal is
              scheduled; Full/Partial pin it for target grading (design 14.5). */}
          <select
            aria-label={`Day ${day.index} type`}
            value={day.dayTypeOverride ?? 'auto'}
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value
              onSetDayType(v === 'full' || v === 'partial' ? v : null)
            }}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-600 disabled:opacity-40"
          >
            <option value="auto">Auto</option>
            <option value="full">Full</option>
            <option value="partial">Partial</option>
          </select>
          <span className="text-sm tabular-nums text-gray-600">
            {formatItemWeight(day.grams, unit)}
          </span>
          <button
            type="button"
            onClick={onRemoveDay}
            disabled={busy}
            aria-label={`Delete Day ${day.index}`}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>
      <div className="divide-y divide-gray-100">
        {day.cells.map((cell) => (
          <MealCell
            key={cell.dayMealId}
            cell={cell}
            unit={unit}
            busy={busy}
            onAddFood={() => onAddFood(cell)}
            onEditEntry={onEditEntry}
            onDeleteEntry={onDeleteEntry}
          />
        ))}
        {day.cells.length === 0 && (
          <p className="px-4 py-3 text-sm text-gray-500">
            No meals on this day. Add a meal above.
          </p>
        )}
      </div>
    </section>
  )
}

function MealCell({
  cell,
  unit,
  busy,
  onAddFood,
  onEditEntry,
  onDeleteEntry,
}: {
  cell: PlanCellView
  unit: 'g' | 'oz'
  busy: boolean
  onAddFood: () => void
  onEditEntry: (entry: PlanEntryView) => void
  onDeleteEntry: (entry: PlanEntryView) => void
}) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {cell.mealName}
        </h3>
        <span className="text-xs tabular-nums text-gray-400">
          {formatItemWeight(cell.grams, unit)}
        </span>
      </div>
      {cell.entries.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {cell.entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              unit={unit}
              busy={busy}
              onEdit={() => onEditEntry(entry)}
              onDelete={() => onDeleteEntry(entry)}
            />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onAddFood}
        disabled={busy}
        className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40"
      >
        <Plus size={14} />
        Add food
      </button>
    </div>
  )
}

function ExtrasSection({
  extras,
  unit,
  busy,
  onAddFood,
  onEditEntry,
  onDeleteEntry,
}: {
  extras: PlanExtrasView
  unit: 'g' | 'oz'
  busy: boolean
  onAddFood: () => void
  onEditEntry: (entry: PlanEntryView) => void
  onDeleteEntry: (entry: PlanEntryView) => void
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Extras</h2>
          <p className="text-xs text-gray-500">
            Food you&apos;re carrying that isn&apos;t tied to a meal.
          </p>
        </div>
        <span className="text-sm tabular-nums text-gray-600">
          {formatItemWeight(extras.grams, unit)}
        </span>
      </header>
      <div className="px-4 py-2.5">
        {extras.entries.length > 0 && (
          <ul className="flex flex-col gap-1">
            {extras.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                unit={unit}
                busy={busy}
                onEdit={() => onEditEntry(entry)}
                onDelete={() => onDeleteEntry(entry)}
              />
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onAddFood}
          disabled={busy}
          className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40"
        >
          <Plus size={14} />
          Add food
        </button>
      </div>
    </section>
  )
}

function EntryRow({
  entry,
  unit,
  busy,
  onEdit,
  onDelete,
}: {
  entry: PlanEntryView
  unit: 'g' | 'oz'
  busy: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const name = entry.food?.name ?? 'Unknown food'
  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className="flex min-w-0 flex-1 items-baseline gap-2 text-left disabled:opacity-60"
      >
        <span className="min-w-0 truncate text-sm text-gray-900">{name}</span>
        <span className="shrink-0 text-xs text-gray-500">
          {describeEntryAmount(entry.basis, entry.amount, unit)}
        </span>
        {entry.incomplete && (
          <span
            className="inline-flex shrink-0 items-center text-amber-600"
            title="Not enough info to weigh this item; it isn't counted in the total."
          >
            <AlertTriangle size={12} />
          </span>
        )}
      </button>
      <span className="shrink-0 text-sm tabular-nums text-gray-600">
        {entry.incomplete ? '—' : formatItemWeight(entry.grams, unit)}
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={busy}
        aria-label={`Remove ${name}`}
        className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
      >
        <Trash2 size={14} />
      </button>
    </li>
  )
}

// Single-text-field dialog, shared by rename plan and add meal.
function NameDialog({
  title,
  label,
  initialValue,
  submitLabel,
  saving,
  saveError,
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  initialValue: string
  submitLabel: string
  saving: boolean
  saveError: string | null
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('Enter a name.')
      return
    }
    setError(null)
    onSubmit(trimmed)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      className="w-full max-w-sm"
      closeOnBackdropClick={false}
    >
      <form onSubmit={handleSubmit} className="p-6" noValidate>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="mt-4">
          <FormLabel htmlFor="name-dialog-input">{label}</FormLabel>
          <input
            id="name-dialog-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {(error ?? saveError) && (
          <p className="mt-3 text-sm text-red-600">{error ?? saveError}</p>
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
            {saving ? 'Saving…' : submitLabel}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  )
}
