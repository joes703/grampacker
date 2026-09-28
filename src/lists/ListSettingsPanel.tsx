import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Copy, Download, Pencil, Trash2 } from 'lucide-react'
import type { List } from '../lib/types'
import { RowMenuItem } from '../components/RowMenuItem'
import ConfirmDialog from '../components/ConfirmDialog'
import ToggleSwitch from '../components/ToggleSwitch'
import { INLINE_EDIT_FOCUS_RING, PANEL_TOGGLE_LABEL } from '../components/flat-table-styles'
import { useCommitOnce } from '../lib/use-commit-once'
import PrivacyPanel from './PrivacyPanel'
import { useCurrentListActions } from './use-current-list-actions'

type Props = {
  list: List
  /**
   * Closes a host that is a top-layer Modal (the mobile one), so the toast of
   * an action that fails after the click is seen. The desktop popover leaves it
   * out: a toast shows over it, and closing it would unmount this panel and
   * with it the "Exporting…" guard against a second export of the same list.
   */
  onClose?: () => void
}

// Current-list management panel. Toggles for list-level settings stack
// above a subtle divider; below the divider are list lifecycle actions
// (Rename inline, Duplicate, Export CSV, Delete list).
//
// Toggles:
//   - Draft: label-only lifecycle state, shared with CurrentListHeader's
//     pill via draftToggle.
//   - Sharing: PrivacyPanel's inline body (toggle + url + Copy when
//     public).
//
// "Add ready checks" used to live here as a third toggle. It moved to
// PackingProgress and was then retired entirely: ready checks are
// unconditional, so there is nothing left to toggle. What survives of the
// original reasoning is why it did not belong here - it is a pack-mode-only
// concern and this panel is hidden in pack mode (see ListDocumentToolbar /
// MobileListActionBar), which is the same test to apply to the next
// pack-only control someone wants to put here.
//
// Actions reuse the shared useCurrentListActions hook so the /lists
// card kebab and this panel call the same renameMut/duplicateMut/
// deleteListMut handlers - one canonical code path, multiple entry
// points.
//
// Rename UI: clicking "Rename" replaces the menu item with an inline
// input. Enter saves, Escape cancels, blur saves (matching the same
// keyboard semantics as InlineTitle, the desktop pencil affordance).
// Same renameMut runs in either path.
//
// Mounted inside ListSettingsButton's popover at md+ and inside a
// Modal on mobile via MobileListActionBar's Options slot. Both mount
// points are themselves suppressed in pack mode.
//
// FAILURES. On mobile this panel is inside a top-layer Modal, where a toast is
// never seen (the rule in src/lib/mutation-error-handler.ts). So each action
// either gets out of the way before it can fail, or reports in place:
//   - Duplicate and Export CSV close the mobile Modal on the CLICK, so their
//     toasts land on the page. It keeps this panel mounted while closed.
//   - Delete leaves for /lists on the click. That is also what makes the delete
//     land anywhere: the optimistic removal drops this list from ['lists'],
//     ListDetailPage swaps to "List not found" and unmounts this panel, and an
//     unmounted mutation observer never runs a per-call onSuccess.
//   - Rename reports inline. Its snap-back is not under the cursor here (the
//     input is gone by the time it lands) and on mobile the title it reverts
//     sits behind the backdrop, so the rollback alone says nothing.
export default function ListSettingsPanel({ list, onClose }: Props) {
  const navigate = useNavigate()

  const { renameMut, duplicateMut, deleteListMut, exportCsv, exportingListId, draftToggle } = useCurrentListActions()
  const exporting = exportingListId === list.id

  // Inline rename state. Mirrors InlineTitle's keyboard semantics
  // (Enter saves, Escape cancels, blur saves) but stays scoped to this
  // panel so we don't have to lift state out of CurrentListHeader and
  // across the desktop/mobile mount split.
  //
  // Draft seeding happens in startRename (the event handler), not in
  // an effect: react-hooks/set-state-in-effect bans the
  // setState-in-effect shortcut, and seeding at event time also avoids
  // clobbering the user's draft if list.name changes mid-rename (e.g.
  // an optimistic-update echo).
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  const commitOnce = useCommitOnce()

  function startRename() {
    setRenameError(null)
    setDraft(list.name)
    setRenaming(true)
  }

  function commitRename() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== list.name) {
      // Per-call, so it reaches only this panel's own renames, and only while it
      // is mounted: a desktop popover closed mid-flight has nowhere to say it.
      renameMut.mutate(
        { id: list.id, name: trimmed },
        { onError: () => setRenameError("Couldn't confirm the new name was saved. Please try again.") },
      )
    }
    setRenaming(false)
  }

  function cancelRename() {
    setRenaming(false)
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className={PANEL_TOGGLE_LABEL}>Draft</span>
        <ToggleSwitch
          checked={list.isDraft}
          onChange={() => draftToggle.toggle(list)}
          disabled={draftToggle.isPending}
          ariaLabel="Draft"
        />
      </div>
      <PrivacyPanel list={list} />

      {/* Actions section. The -mx-3 spans the popover's p-3 padding so
          the divider and action rows go edge-to-edge while RowMenuItem's
          own px-3 keeps the visible content inset where the toggles
          above sit.
          This surface is a settings panel rather than an ARIA menu, so each
          action is a plain button. The card
          kebabs in ListsPage keep menu semantics where they belong. */}
      <div className="-mx-3 border-t border-gray-100 pt-1">
        <div className="space-y-0.5">
          {renaming ? (
            <div className="px-3 py-0.5">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitOnce(commitRename)
                  if (e.key === 'Escape') commitOnce(cancelRename)
                }}
                onBlur={() => commitOnce(commitRename)}
                maxLength={120}
                aria-label="List name"
                className={`w-full rounded border border-blue-400 px-2 py-1 text-sm ${INLINE_EDIT_FOCUS_RING}`}
              />
            </div>
          ) : (
            <RowMenuItem
              icon={<Pencil size={13} />}
              onClick={startRename}
            >
              Rename
            </RowMenuItem>
          )}
          {renameError && (
            <p role="alert" className="px-3 py-1 text-xs text-red-600">
              {renameError}
            </p>
          )}
          <RowMenuItem
            icon={<Copy size={13} />}
            onClick={() => {
              onClose?.()
              duplicateMut.mutate(list)
            }}
          >
            Duplicate
          </RowMenuItem>
          <RowMenuItem
            icon={<Download size={13} />}
            onClick={() => {
              onClose?.()
              void exportCsv(list)
            }}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </RowMenuItem>
          <RowMenuItem
            icon={<Trash2 size={13} />}
            tone="danger"
            onClick={() => setConfirmingDelete(true)}
          >
            Delete list
          </RowMenuItem>
        </div>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete list"
          message={`This will permanently delete "${list.name}" and all of its items. This cannot be undone.`}
          confirmLabel="Delete list"
          dangerous
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => {
            setConfirmingDelete(false)
            // Leave on the click, not on success: see FAILURES above. A failed
            // delete rolls back and toasts on /lists, where the toast is seen.
            deleteListMut.mutate(list.id)
            void navigate('/lists')
          }}
        />
      )}
    </div>
  )
}
