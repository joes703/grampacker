import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import ToggleSwitch from '../components/ToggleSwitch'
import { PANEL_TOGGLE_LABEL } from '../components/flat-table-styles'

type Props = { list: List }

// Inner UI for the share/privacy controls - public/private toggle plus a
// copyable share URL when public. Consumed by ListSettingsPanel's Sharing
// section on the list detail page, and by the per-row Share dialog on the
// Lists page (modal-wrapped to avoid nesting popovers inside a kebab).
// Section heading and supporting copy live in the parent so this body
// stays minimal.
//
// The slug never changes: toggling off kills /r/:slug access, toggling
// back on revives the SAME url. Breaking a leaked link means duplicating
// the list (fresh slug) and unsharing the original.
//
// TRANSPLANT NOTE (food): the old panel had an "Include food plan" toggle
// below the URL row (is_food_shared). That returns with the food slice.
export default function PrivacyPanel({ list }: Props) {
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)

  // The PATCH body and the optimistic apply both use the SAME explicit
  // target value, resolved once in toggleSharing. A relative toggle here
  // (mutationFn reading the rendered `list.isShared`) races: the
  // optimistic update flips the cache immediately, but observer
  // notifications are scheduled, so a second activation before this
  // component re-renders would close over the stale prop and send the
  // SAME body twice - from private, that leaves the list PUBLIC while
  // the UI says private. A privacy control gets the belt-and-suspenders
  // treatment: absolute target + disabled while a flip is in flight
  // (which also stops two opposite PATCHes racing each other on the
  // wire).
  const toggleMut = useMutation({
    mutationFn: (isShared: boolean) => updateList(list.id, { isShared }),
    ...makeOptimisticUpdate<List, boolean>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item, isShared) => ({ ...item, isShared }),
    }),
  })

  function toggleSharing() {
    if (toggleMut.isPending) return
    // Derive the target from the live cache row, not the rendered prop:
    // some parents (ListSettingsPanel) pass a snapshot that can lag the
    // cache by a scheduler tick.
    const live =
      qc.getQueryData<List[]>(queryKeys.lists())?.find((l) => l.id === list.id) ?? list
    toggleMut.mutate(!live.isShared)
  }

  const shareUrl = `${window.location.origin}/r/${list.slug}`

  return (
    <>
      <div className="flex items-center justify-between">
        <span className={PANEL_TOGGLE_LABEL}>Sharing</span>
        <ToggleSwitch
          checked={list.isShared}
          onChange={toggleSharing}
          disabled={toggleMut.isPending}
          ariaLabel={list.isShared ? 'Disable public link' : 'Enable public link'}
        />
      </div>
      {list.isShared && (
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
                // ignore - clipboard unavailable
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
    </>
  )
}
