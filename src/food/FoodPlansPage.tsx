import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ChevronRight, Copy, MoreVertical, Plus, Trash2 } from 'lucide-react'
import { queryKeys, fetchFoodPlans, type FoodPlanSummary } from '../lib/queries'
import { ApiError } from '../lib/api'
import { useDocumentTitle } from '../lib/use-document-title'
import PrimaryButton from '../components/PrimaryButton'
import ConfirmDialog from '../components/ConfirmDialog'
import FoodTabs from './FoodTabs'
import CreatePlanDialog from './CreatePlanDialog'
import MobilePlanActionBar from './MobilePlanActionBar'
import { useFoodPlanActions } from './use-food-plan-actions'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import { POPOVER_SURFACE } from '../components/flat-table-styles'
import { useAnchoredMenu } from '../lib/use-anchored-menu'

type Dialog =
  | { type: 'create' }
  | { type: 'delete'; plan: FoodPlanSummary }

export default function FoodPlansPage() {
  useDocumentTitle('Food plans')
  const navigate = useNavigate()

  const {
    data: plans = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.foodPlans(),
    queryFn: fetchFoodPlans,
  })

  const { createPlan, duplicatePlan, removePlan } = useFoodPlanActions()
  const [dialog, setDialog] = useState<Dialog | null>(null)

  function handleCreate(input: { name: string; days: number }) {
    createPlan.mutate(input, {
      onSuccess: (doc) => {
        setDialog(null)
        void navigate(`/food/plans/${doc.id}`)
      },
    })
  }

  return (
    <div>
      <FoodTabs />

      <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Plans</h1>
          <span className="text-sm text-gray-500">
            {plans.length} {plans.length === 1 ? 'plan' : 'plans'}
          </span>
        </div>

        {/* Desktop-only (>=lg): the mobile bottom bar owns Add below lg, so the
            header button would duplicate it. lg (not md) hands off at exactly
            the width the bar disappears. */}
        <div className="ml-auto hidden lg:block">
          <PrimaryButton onClick={() => setDialog({ type: 'create' })} size="sm">
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} />
              New plan
            </span>
          </PrimaryButton>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : isError && plans.length === 0 ? (
        <p className="text-sm text-red-600">
          Couldn&apos;t load your plans. Refresh the page and try again.
        </p>
      ) : plans.length === 0 ? (
        <PlansEmptyState onCreate={() => setDialog({ type: 'create' })} />
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Food plans">
          {plans.map((plan) => (
            <FoodPlanRow
              key={plan.id}
              plan={plan}
              duplicating={duplicatePlan.isPending}
              onDuplicate={() => duplicatePlan.mutate(plan.id)}
              onDelete={() => setDialog({ type: 'delete', plan })}
            />
          ))}
        </ul>
      )}

      {dialog?.type === 'create' && (
        <CreatePlanDialog
          onCreate={handleCreate}
          onClose={() => setDialog(null)}
          saving={createPlan.isPending}
          saveError={createErrorMessage(createPlan.error)}
        />
      )}

      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Delete plan"
          message={`This will delete "${dialog.plan.name}" and everything in it. Your food library is not affected. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            removePlan.mutate(dialog.plan.id)
            setDialog(null)
          }}
        />
      )}

      <MobilePlanActionBar onNewPlan={() => setDialog({ type: 'create' })} />
    </div>
  )
}

function FoodPlanRow({
  plan,
  duplicating,
  onDuplicate,
  onDelete,
}: {
  plan: FoodPlanSummary
  duplicating: boolean
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { open, openMenu, close, triggerRef, menuRef, menuPos } =
    useAnchoredMenu({ variant: 'right-flush', menuWidth: 176 })

  return (
    <li className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-3">
      <Link
        to={`/food/plans/${plan.id}`}
        className="group flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-gray-900 group-hover:text-blue-600">
            {plan.name}
          </div>
          <div className="truncate text-xs text-gray-500">
            {plan.dayCount} {plan.dayCount === 1 ? 'day' : 'days'} ·{' '}
            {plan.entryCount} {plan.entryCount === 1 ? 'item' : 'items'}
            {plan.usedByListName !== null && ` · In use by ${plan.usedByListName}`}
          </div>
        </div>
        <ChevronRight
          size={16}
          className="shrink-0 text-gray-400 group-hover:text-blue-600"
        />
      </Link>

      <RowIconButton
        touchSafe
        ref={triggerRef}
        onClick={() => open ? close() : openMenu()}
        aria-expanded={open}
        ariaLabel={`${plan.name} options`}
        icon={<MoreVertical size={15} />}
      />

      {open && menuPos && 'left' in menuPos && createPortal(
        <div
          ref={menuRef}
          role="group"
          aria-label={`${plan.name} actions`}
          className={`fixed z-50 w-44 py-1 ${POPOVER_SURFACE}`}
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <RowMenuItem
            icon={<Copy size={13} />}
            disabled={duplicating}
            onClick={() => {
              close()
              onDuplicate()
            }}
          >
            Duplicate plan
          </RowMenuItem>
          <RowMenuSeparator />
          <RowMenuItem
            icon={<Trash2 size={13} />}
            tone="danger"
            onClick={() => {
              close()
              onDelete()
            }}
          >
            Delete plan
          </RowMenuItem>
        </div>,
        document.body,
      )}
    </li>
  )
}

function createErrorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ApiError) return err.message
  return 'Something went wrong. Please try again.'
}

function PlansEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
      <h2 className="text-base font-semibold text-gray-900">No plans yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
        A plan lays out what you&apos;ll eat each day so you can see the food
        weight you&apos;re carrying. Build one from foods in your library.
      </p>
      <div className="mt-5 flex justify-center">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          New plan
        </button>
      </div>
    </section>
  )
}
