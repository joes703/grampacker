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

  const toggleMut = useMutation({
    mutationFn: () => updateList(list.id, { isShared: !list.isShared }),
    // apply ignores the void input and toggles based on the cache row's
    // current isShared - the cache is the source of truth at apply time,
    // so rapid double-toggles still track correctly.
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, isShared: !item.isShared }),
    }),
  })

  const shareUrl = `${window.location.origin}/r/${list.slug}`

  return (
    <>
      <div className="flex items-center justify-between">
        <span className={PANEL_TOGGLE_LABEL}>Sharing</span>
        <ToggleSwitch
          checked={list.isShared}
          onChange={() => toggleMut.mutate()}
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
