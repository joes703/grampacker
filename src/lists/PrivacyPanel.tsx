import { useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { List } from '../lib/types'
import ToggleSwitch from '../components/ToggleSwitch'
import { PANEL_TOGGLE_LABEL } from '../components/flat-table-styles'
import { queryKeys, rotateShareLink } from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import { useListFlagToggle } from './use-list-flag-toggle'

type Props = { list: List }

// Inner UI for the share/privacy controls - public/private toggle, a copyable
// share URL when public, and a control to replace that URL. Consumed by
// ListSettingsPanel's Sharing section on the list detail page, and by the
// per-row Share dialog on the Lists page (modal-wrapped to avoid nesting
// popovers inside a kebab). Section heading and supporting copy live in the
// parent so this body stays minimal.
//
// TOGGLING IS NOT DESTRUCTIVE. Off kills /r/:slug access, on revives the SAME
// url. That is deliberate and worth preserving: people paste these links into
// places they cannot easily edit afterwards - a Reddit flair, a forum
// signature - so silently retargeting them on an unrelated action would break
// other people's pages without telling anyone.
//
// Replacing the link is therefore its OWN control, because it is its own
// intention. It swaps the slug and leaves sharing exactly as it was.
//
// The confirm is inline rather than a ConfirmDialog because this panel already
// renders inside a Modal on the Lists page, and a ConfirmDialog is itself a
// Modal.
//
// The flip goes through useListFlagToggle (absolute target + synchronous
// in-flight ref) - see that hook for the double-toggle races the naive
// shape carries; on a privacy control they could leave a list PUBLIC
// while the UI says private. disabled while pending is the visual layer
// on top of the hook's guard.
//
export default function PrivacyPanel({ list }: Props) {
  const [copied, setCopied] = useState(false)
  const [confirmingReplace, setConfirmingReplace] = useState(false)
  const qc = useQueryClient()

  // `disabled={isPending}` is render-derived, so two clicks inside one commit
  // window both get through and rotate the slug TWICE - burning a link the
  // person never saw. Same trap useListFlagToggle documents; same fix, a
  // synchronous ref. Cleared in the mutation's onSettled (success AND error).
  const replacing = useRef(false)

  const shareToggle = useListFlagToggle({
    read: (l) => l.isShared,
    patch: (isShared) => ({ isShared }),
  })

  // Not optimistic: the slug is server-minted, so there is nothing to guess.
  // Invalidate and let the new row arrive.
  const replaceMut = useMutation({
    mutationKey: mutationKeys.rotateShareLink(),
    mutationFn: (id: string) => rotateShareLink(id),
    meta: { errorToast: "Couldn't replace that link. Please try again." },
    onSuccess: () => {
      setConfirmingReplace(false)
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
    },
    onSettled: () => {
      replacing.current = false
    },
  })

  function replaceLink() {
    if (replacing.current) return
    replacing.current = true
    replaceMut.mutate(list.id)
  }

  const shareUrl = `${window.location.origin}/r/${list.slug}`

  return (
    <>
      <div className="flex items-center justify-between">
        <span className={PANEL_TOGGLE_LABEL}>Sharing</span>
        <ToggleSwitch
          checked={list.isShared}
          onChange={() => shareToggle.toggle(list)}
          disabled={shareToggle.isPending}
          ariaLabel={list.isShared ? 'Disable public link' : 'Enable public link'}
        />
      </div>
      {list.isShared && (
        <>
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
          {confirmingReplace ? (
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-600">
                The current link stops working.
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmingReplace(false)}
                  className="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={replaceLink}
                  disabled={replaceMut.isPending}
                  className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingReplace(true)}
              className="mt-2 text-xs text-gray-500 underline hover:text-gray-700"
            >
              Replace link
            </button>
          )}
        </>
      )}
    </>
  )
}
