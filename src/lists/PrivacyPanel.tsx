import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import type { List } from '../lib/types'
import {
  queryKeys, updateList, makeOptimisticUpdate,
  fetchFoodPlan, updateFoodPlanShare, invalidateFoodPlanCaches,
} from '../lib/queries'
import { useRequireSession } from '../auth/use-require-session'
import ToggleSwitch from '../components/ToggleSwitch'
import { PANEL_TOGGLE_LABEL } from '../components/flat-table-styles'

type Props = { list: List }

// Inner UI for the share/privacy controls — public/private toggle plus a
// copyable share URL when public. Consumed by ListSettingsPanel's Sharing
// section on the list detail page, and by the per-row Share dialog on the
// Lists page (modal-wrapped to avoid nesting popovers inside a kebab).
// Section heading and supporting copy live in the parent so this body
// stays minimal.
export default function PrivacyPanel({ list }: Props) {
  const qc = useQueryClient()
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const [copied, setCopied] = useState(false)

  const toggleMut = useMutation({
    mutationFn: () => updateList(list.id, { is_shared: !list.is_shared }),
    // apply ignores the void input and toggles based on the cache row's
    // current is_shared — the cache is the source of truth at apply time,
    // so rapid double-toggles still track correctly.
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, is_shared: !item.is_shared }),
    }),
  })
  const foodPlanQuery = useQuery({
    queryKey: queryKeys.foodPlan(list.id),
    queryFn: () => fetchFoodPlan(userId, list.id),
    enabled: list.is_shared && Boolean(userId),
  })
  const foodPlan = foodPlanQuery.data ?? null
  const foodShareMut = useMutation({
    mutationFn: (v: { foodPlanId: string; isFoodShared: boolean }) =>
      updateFoodPlanShare(v.foodPlanId, v.isFoodShared),
    meta: { errorToast: "Couldn't update Food plan sharing. Please try again." },
    onSuccess: () => invalidateFoodPlanCaches(qc, list.id),
  })

  const shareUrl = `${window.location.origin}/r/${list.slug}`

  return (
    <>
      <div className="flex items-center justify-between">
        <span className={PANEL_TOGGLE_LABEL}>Sharing</span>
        <ToggleSwitch
          checked={list.is_shared}
          onChange={() => toggleMut.mutate()}
          ariaLabel={list.is_shared ? 'Disable public link' : 'Enable public link'}
        />
      </div>
      {list.is_shared && (
        <div className="mt-2 flex gap-1">
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(shareUrl)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                // ignore — clipboard unavailable
              }
            }}
            className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
          >
            {copied ? (
              <><Check size={12} className="text-green-600" /> Copied</>
            ) : (
              <><Copy size={12} /> Copy</>
            )}
          </button>
        </div>
      )}
      {list.is_shared && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className={PANEL_TOGGLE_LABEL}>Include food plan</span>
            <ToggleSwitch
              checked={Boolean(foodPlan?.plan.is_food_shared)}
              onChange={() => {
                if (foodPlan && !foodShareMut.isPending) {
                  foodShareMut.mutate({
                    foodPlanId: foodPlan.plan.id,
                    isFoodShared: !foodPlan.plan.is_food_shared,
                  })
                }
              }}
              disabled={!foodPlan || foodPlanQuery.isLoading || foodShareMut.isPending}
              ariaLabel="Include food plan"
            />
          </div>
          <p className="mt-1 text-xs leading-snug text-gray-500">
            {foodPlanQuery.isLoading
              ? 'Checking for a food plan...'
              : foodPlan
                ? 'Adds the day-by-day food plan to this public link. The Gear list still shows aggregate food weight either way.'
                : 'No food plan exists for this list yet. Start a food plan before including it in the public link.'}
          </p>
        </div>
      )}
    </>
  )
}
