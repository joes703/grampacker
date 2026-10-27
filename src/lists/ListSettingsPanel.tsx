import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Copy, Download, Pencil, Trash2 } from 'lucide-react'
import type { List } from '../lib/types'
import { RowMenuItem } from '../components/RowMenuItem'
import ConfirmDialog from '../components/ConfirmDialog'
import { INLINE_EDIT_FOCUS_RING } from '../components/flat-table-styles'
import InlineRenameInput from '../components/InlineRenameInput'
import { reportFailure } from '../lib/report-failure'
import { MAX_NAME_LENGTH } from '../lib/caps'
import { useCurrentListActions } from './use-current-list-actions'

type Props = {
  list: List
  /**
   * Closes a host that is a Modal (the mobile one) on Duplicate and Export.
   * That once kept their failure toasts from expiring behind it, before toasts
   * rendered over modals; it is kept as their behavior. The desktop popover
   * leaves it out: closing it would unmount this panel and with it the
   * "Exporting…" guard against a second export of the same list.
   */
  onClose?: () => void
}

// Current-list management panel: list lifecycle actions (Rename inline,
// Duplicate, Export CSV, Delete list).
//
// Sharing is deliberately NOT here: buried between Rename and Delete, it is
// hard to find. It has its own toolbar button (ListShareButton), its one
// home on this page. The Draft flag lives there too, because a draft only
// changes what a share's visitors see. Do not add a second entry point for
// either here.
//
// This panel is list-admin. A control that only matters in one view belongs
// inline in that view's document (as pack's filters do in PackingProgress),
// not here.
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
// Mounted inside ListSettingsButton's popover (the toolbar button, every
// mode and viewport) and inside a Modal via MobileListActionBar's Options
// slot (edit mode only - there it is a shortcut, not the only entry point).
//
// FAILURES. Each action either gets out of the way before it can fail, or
// reports in place (the modal rule in src/lib/mutation-error-handler.ts):
//   - Duplicate and Export CSV close the mobile Modal on the CLICK, and report
//     by toast. Modal keeps this panel mounted while closed.
//   - Delete leaves for /lists on the click. That is also what makes the delete
//     land anywhere: the optimistic removal drops this list from ['lists'],
//     ListDetailPage swaps to "List not found" and unmounts this panel, and an
//     unmounted mutation observer never runs a per-call onSuccess.
//   - Rename reports inline, or by toast if the panel is no longer on screen
//     when it fails (src/lib/report-failure.ts). Its snap-back is not under the
//     cursor here (the input is gone by the time it lands) and on mobile the
//     title it reverts sits behind the backdrop, so the rollback alone says
//     nothing. PrivacyPanel's Reset link reports the same way.
export default function ListSettingsPanel({ list, onClose }: Props) {
  const navigate = useNavigate()

  const { renameMut, duplicateMut, deleteListMut, exportCsv, exportingListId } = useCurrentListActions()
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
  const panelRef = useRef<HTMLDivElement>(null)
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
      // reportFailure falls back to a toast if the mobile Modal was closed in
      // the meantime (tapping Export right after typing commits the rename on
      // blur, then closes the Modal).
      renameMut.mutate(
        { id: list.id, name: trimmed },
        {
          onError: () =>
            reportFailure(panelRef.current, "Couldn't confirm the new name was saved. Please try again.", setRenameError),
        },
      )
    }
    setRenaming(false)
  }

  function cancelRename() {
    setRenaming(false)
  }

  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div ref={panelRef} className="space-y-3">
      {/* The -mx-3 spans the popover's p-3 padding so the action rows go
          edge-to-edge while RowMenuItem's own px-3 keeps their content
          inset.
          This surface is a settings panel rather than an ARIA menu, so each
          action is a plain button. The card
          kebabs in ListsPage keep menu semantics where they belong. */}
      <div className="-mx-3">
        <div className="space-y-0.5">
          {renaming ? (
            <div className="px-3 py-0.5">
              <InlineRenameInput
                value={draft}
                onChange={setDraft}
                onSubmit={commitRename}
                onCancel={cancelRename}
                maxLength={MAX_NAME_LENGTH}
                ariaLabel="List name"
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
