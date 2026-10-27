import { useRef, useState } from 'react'
import { Check, Copy, RotateCcw } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { List } from '../lib/types'
import ToggleSwitch from '../components/ToggleSwitch'
import { PANEL_TOGGLE_LABEL } from '../components/flat-table-styles'
import { queryKeys, rotateShareLink } from '../lib/queries'
import { mutationKeys } from '../lib/queries/keys'
import { useListFlagToggle } from './use-list-flag-toggle'
import { reportFailure } from '../lib/report-failure'

type Props = { list: List }

// Inner UI for the share/privacy controls - public/private toggle, a copyable
// share URL when public, a control to reset that URL, and the Draft flag.
// Consumed by ListShareButton on the list detail page, and by the per-row
// Share dialog on the Lists page (modal-wrapped to avoid nesting popovers
// inside a kebab). Section heading and supporting copy live in the
// parent so this body stays minimal.
//
// TOGGLING IS NOT DESTRUCTIVE. Off kills /r/:slug access, on revives the SAME
// url. That is deliberate and worth preserving: people paste these links into
// places they cannot easily edit afterwards - a Reddit flair, a forum
// signature - so silently retargeting them on an unrelated action would break
// other people's pages without telling anyone.
//
// Resetting the link is therefore its OWN control, because it is its own
// intention. It swaps the slug and leaves sharing exactly as it was.
// "Reset link", not "Replace link": replace read as unclear about what is
// being swapped for what.
//
// The confirm is inline rather than a ConfirmDialog because this panel already
// renders inside a Modal on the Lists page, and a ConfirmDialog is itself a
// Modal. A failed reset is reported inline too, beside the control (the modal
// rule in src/lib/mutation-error-handler.ts). Unless the panel has left the
// screen by the time it fails - then only a toast can be seen, so it gets one.
//
// The flip goes through useListFlagToggle (absolute target, one pending
// flip per list and flag) - see that hook for the double-toggle races the
// naive shape carries; on a privacy control they could leave a list PUBLIC
// while the UI says private. disabled while pending is the visual layer
// on top of the hook's guard.
//
export default function PrivacyPanel({ list }: Props) {
  const [copied, setCopied] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  // Held in state rather than read off resetMut.isError, and rendered outside
  // the confirm and the isShared block, so a failure that lands after Cancel or
  // after sharing was turned off still has somewhere to show.
  const [resetError, setResetError] = useState<string | null>(null)
  const qc = useQueryClient()

  // `disabled={isPending}` is render-derived, so two clicks inside one commit
  // window both get through and rotate the slug TWICE - burning a link the
  // person never saw. A synchronous ref closes it, cleared in the mutation's
  // onSettled (success AND error).
  const resetting = useRef(false)
  // Always rendered, so reportFailure can tell whether the panel is on screen.
  const anchorRef = useRef<HTMLDivElement>(null)

  const shareToggle = useListFlagToggle('isShared')
  const draftToggle = useListFlagToggle('isDraft')

  // Not optimistic: the slug is server-minted, so there is nothing to guess.
  // Invalidate and let the new row arrive - on failure too, because a rejected
  // request does not prove the server did not rotate, and the old link shown
  // may already be dead. The rotate is a non-idempotent POST, so the copy
  // advises checking before retrying (AGENTS.md "Traps").
  const resetMut = useMutation({
    mutationKey: mutationKeys.rotateShareLink(),
    mutationFn: (id: string) => rotateShareLink(id),
    // Inline while this panel is on screen; by toast if its Modal was closed or
    // the panel unmounted before the failure landed (src/lib/report-failure.ts).
    onError: () => {
      reportFailure(
        anchorRef.current,
        "Couldn't confirm the link was reset. Refresh to check before trying again.",
        setResetError,
      )
    },
    onSettled: () => {
      resetting.current = false
      setConfirmingReset(false)
      void qc.invalidateQueries({ queryKey: queryKeys.lists() })
    },
  })

  function resetLink() {
    if (resetting.current) return
    resetting.current = true
    setResetError(null)
    resetMut.mutate(list.id)
  }

  const shareUrl = `${window.location.origin}/r/${list.slug}`

  return (
    <>
      <div ref={anchorRef} className="flex items-center justify-between">
        {/* "Shared", a state adjective like its sibling "Draft": the switch
            shows whether the list IS shared, not a place sharing happens. */}
        <span className={PANEL_TOGGLE_LABEL}>Shared</span>
        <ToggleSwitch
          checked={list.isShared}
          onChange={() => shareToggle.toggle(list)}
          disabled={shareToggle.isPending}
          ariaLabel={list.isShared ? 'Disable public link' : 'Enable public link'}
        />
      </div>
      {list.isShared && (
        <>
          {/* The URL gets the full row to itself; its two actions sit
              together below it in one small bordered family, Copy first. */}
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full min-w-0 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-2 flex items-center gap-1">
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
            {!confirmingReset && (
              // Not reopenable while a reset is in flight: its settlement
              // closes the confirm, and would close a reopened one out from
              // under the user.
              <button
                type="button"
                onClick={() => setConfirmingReset(true)}
                disabled={resetMut.isPending}
                className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                <RotateCcw size={12} /> Reset link
              </button>
            )}
          </div>
          {confirmingReset && (
            <div className="mt-2 flex items-center justify-between gap-2">
              {/* Names the outcome, not just the loss: "Reset" alone could
                  read as turning sharing off or restoring an old link. */}
              <span className="text-xs text-gray-600">
                You get a new link; the current link stops working.
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmingReset(false)}
                  className="rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={resetLink}
                  disabled={resetMut.isPending}
                  className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Reset
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {resetError && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {resetError}
        </p>
      )}
      {/* Draft lives here because it only changes what a share's visitors
          see: a work-in-progress note on the shared page (DraftBanner).
          Every new list starts as a draft (server default), so the line
          below says what the flag does. */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between">
          <span className={PANEL_TOGGLE_LABEL}>Draft</span>
          <ToggleSwitch
            checked={list.isDraft}
            onChange={() => draftToggle.toggle(list)}
            disabled={draftToggle.isPending}
            ariaLabel="Draft"
          />
        </div>
        <p className="mt-1 text-xs text-gray-500">
          New lists start as drafts. A shared draft shows visitors a
          work-in-progress note.
        </p>
      </div>
    </>
  )
}
