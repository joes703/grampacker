import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'

type Props = { list: List }

// Inner UI for the share/privacy controls — public/private toggle plus a
// copyable share URL when public. Rendered inside PrivacyButton's portal
// popover at md+, and inside a Modal triggered from the mobile kebab at
// <md. Both surfaces share this body so behavior stays identical.
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
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-900">Public link</span>
        <ToggleSwitch checked={list.is_shared} onChange={() => toggleMut.mutate()} />
      </div>
      {list.is_shared ? (
        <>
          <p className="text-xs text-gray-500 mb-2">
            Public — anyone can view this list, and public lists may be discoverable without the link.
          </p>
          <div className="flex gap-1">
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
        </>
      ) : (
        <p className="text-xs text-gray-500">Toggle on to share this list with anyone via link.</p>
      )}
    </>
  )
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
