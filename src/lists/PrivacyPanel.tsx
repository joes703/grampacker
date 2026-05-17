import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import ToggleSwitch from '../components/ToggleSwitch'

type Props = { list: List }

// Inner UI for the share/privacy controls — public/private toggle plus a
// copyable share URL when public. Today's only consumer is ListSettingsPanel's
// Sharing section (the standalone PrivacyButton is still used on per-card
// share affordances inside ListsPage). Section heading and supporting copy
// live in the parent so this body stays minimal.
export default function PrivacyPanel({ list }: Props) {
  const qc = useQueryClient()
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

  const shareUrl = `${window.location.origin}/r/${list.slug}`

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900">Public link</span>
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
    </>
  )
}
