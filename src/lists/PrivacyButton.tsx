import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { Check, Copy, Globe, Lock } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList } from '../lib/queries'

type Props = { list: List }

// Privacy toggle + share-link manager. The trigger is a single icon button;
// clicking opens a popover (portal-rendered to escape any overflow clipping)
// with a public/private switch and a copyable share URL when the list is
// public. Outside-click + scroll/resize close the popover.
export default function PrivacyButton({ list }: Props) {
  const qc = useQueryClient()
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  const toggleMut = useMutation({
    mutationFn: () => updateList(list.id, { is_shared: !list.is_shared }),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.lists() }),
  })

  function openPopover() {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right })
  }

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      const t = e.target as Node
      if (
        popoverRef.current && !popoverRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setPos(null)
      }
    }
    function handleScroll() { setPos(null) }
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleScroll)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleScroll)
    }
  }, [open])

  const shareUrl = `${window.location.origin}/r/${list.share_token}`

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setPos(null) : openPopover())}
        title={list.is_shared ? 'Public — click to manage' : 'Private — click to manage'}
        aria-pressed={list.is_shared}
        className={`inline-flex items-center justify-center rounded-lg border p-1.5 ${
          list.is_shared
            ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
            : 'border-gray-300 text-gray-500 hover:bg-gray-50'
        }`}
      >
        {list.is_shared ? <Globe size={16} /> : <Lock size={16} />}
      </button>

      {open && pos && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-50 w-80 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-900">Public link</span>
            <ToggleSwitch checked={list.is_shared} onChange={() => toggleMut.mutate()} />
          </div>
          {list.is_shared ? (
            <>
              <p className="text-xs text-gray-500 mb-2">Anyone with this link can view the list.</p>
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
        </div>,
        document.body,
      )}
    </>
  )
}

// Private to PrivacyButton — small switch widget. If a second consumer ever
// appears, hoist this to src/components/.
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
