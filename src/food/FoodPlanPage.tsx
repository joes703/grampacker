import { useState } from 'react'
import { useParams, Link } from 'react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRequireSession } from '../auth/use-require-session'
import { useDocumentTitle } from '../lib/use-document-title'
import { queryKeys, fetchFoodPlan, createFoodPlan, copyFoodPlanToList, invalidateFoodPlanCaches, fetchLists } from '../lib/queries'
import PrimaryButton from '../components/PrimaryButton'
import ListWorkspaceTabs from '../lists/ListWorkspaceTabs'
import CurrentListHeader from '../lists/CurrentListHeader'
import ListSettingsButton from '../lists/ListSettingsButton'
import CreateFoodPlanDialog from './CreateFoodPlanDialog'
import CopyFoodPlanDialog from './CopyFoodPlanDialog'
import FoodPlanDocument from './FoodPlanDocument'
import FoodPlanSkeleton from './FoodPlanSkeleton'
import type { FoodPlanStructure } from '../lib/food/basis'

export default function FoodPlanPage() {
  const { id: listId } = useParams<{ id: string }>()
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const qc = useQueryClient()
  useDocumentTitle('Food plan')

  const planQuery = useQuery({
    queryKey: queryKeys.foodPlan(listId ?? ''),
    queryFn: () => fetchFoodPlan(userId, listId ?? ''),
    enabled: Boolean(listId),
  })

  // Owner-scoped list lookup for the in-page document header (list name +
  // List options). Shares the ['lists'] cache with /lists and the gear/pack
  // detail page, so this usually resolves from cache rather than refetching.
  const listsQuery = useQuery({
    queryKey: queryKeys.lists(),
    queryFn: () => fetchLists(userId),
    enabled: Boolean(userId),
  })
  const list = listsQuery.data?.find((l) => l.id === listId)

  const [showCreate, setShowCreate] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const createMut = useMutation({
    mutationFn: (structure: FoodPlanStructure) =>
      createFoodPlan(userId, listId ?? '', structure),
    meta: { errorToast: "Couldn't start the food plan. Please try again." },
    onSuccess: () => {
      setShowCreate(false)
      return invalidateFoodPlanCaches(qc, listId ?? '')
    },
  })
  const copyMut = useMutation({
    mutationFn: (sourceFoodPlanId: string) =>
      copyFoodPlanToList(userId, sourceFoodPlanId, listId ?? ''),
    meta: { errorToast: "Couldn't copy the food plan. Please try again." },
    onSuccess: () => {
      setShowCopy(false)
      return invalidateFoodPlanCaches(qc, listId ?? '')
    },
  })

  if (!listId) return null

  return (
    // Wide workspace: the Food Plan route fills AppShell's max-w-7xl main
    // (px-4 + pt) exactly like the gear/pack tabs, instead of re-constraining
    // to max-w-3xl. The old narrow cap was a core source of divergence from the
    // approved prototype - the stat strip, all-days table, and day document all
    // need the wider column. Mobile is unchanged (the cap never applied below
    // the 768px breakpoint). Short empty/error states keep their own readable
    // max-width so they don't stretch across the full width.
    <div>
      <ListWorkspaceTabs listId={listId} active="food" />

      {/* Desktop in-page document header. Mirrors ListDocumentToolbar on the
          gear/pack tabs (the global top bar is global-only on desktop, so list
          identity + List options live in the document column). Mobile keeps the
          list name in NavBar's route heading. */}
      {list ? (
        <div className="mt-4 hidden items-center gap-2 md:flex">
          <CurrentListHeader list={list} />
          <div className="ml-auto flex items-center gap-2">
            <ListSettingsButton list={list} />
          </div>
        </div>
      ) : null}

      {planQuery.isLoading ? (
        <FoodPlanSkeleton />
      ) : planQuery.isError ? (
        <div className="mt-6 max-w-2xl">
          <p className="text-sm text-gray-700">Couldn't load this food plan.</p>
          <button type="button" onClick={() => planQuery.refetch()} className="mt-2 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
            Try again
          </button>
        </div>
      ) : !planQuery.data ? (
        <div className="mt-6 max-w-2xl">
          <h1 className="text-lg font-semibold text-gray-900">No food plan yet</h1>
          <p className="mt-1 text-sm text-gray-600">
            Track the food you'll carry - its weight and, if you want, nutrition by day and meal.
            Start fresh, or copy one of your own food plans to reuse the same menu.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryButton type="button" onClick={() => setShowCreate(true)}>
              Start food plan
            </PrimaryButton>
            <button
              type="button"
              onClick={() => setShowCopy(true)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Copy existing plan
            </button>
          </div>
          <p className="mt-3 text-sm">
            <Link to={`/lists/${listId}`} className="text-gray-500 hover:underline">Back to gear list</Link>
          </p>
        </div>
      ) : (
        <FoodPlanDocument listId={listId} userId={userId} doc={planQuery.data} />
      )}

      {showCreate ? (
        <CreateFoodPlanDialog
          saving={createMut.isPending}
          onCreate={(structure) => createMut.mutate(structure)}
          onClose={() => setShowCreate(false)}
        />
      ) : null}
      {showCopy ? (
        <CopyFoodPlanDialog
          userId={userId}
          targetListId={listId}
          copying={copyMut.isPending}
          onCopy={(sourceFoodPlanId) => copyMut.mutate(sourceFoodPlanId)}
          onClose={() => setShowCopy(false)}
        />
      ) : null}
    </div>
  )
}
