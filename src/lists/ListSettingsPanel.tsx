import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { Copy, Download, Pencil, Trash2 } from 'lucide-react'
import type { List } from '../lib/types'
import { queryKeys, updateList, makeOptimisticUpdate } from '../lib/queries'
import { useRequireSession } from '../auth/use-require-session'
import { RowMenuItem } from '../components/RowMenuItem'
import ConfirmDialog from '../components/ConfirmDialog'
import ToggleSwitch from '../components/ToggleSwitch'
import { INLINE_EDIT_FOCUS_RING, PANEL_TOGGLE_LABEL } from '../components/flat-table-styles'
import PrivacyPanel from './PrivacyPanel'
import { useCurrentListActions } from './use-current-list-actions'

type Props = { list: List }

// Current-list management panel. Toggles for list-level settings stack
// above a subtle divider; below the divider are list lifecycle actions
// (Rename inline, Duplicate, Export CSV, Delete list).
//
// Toggles:
//   - Group worn items: moves worn items into their own grouped
//     section across every view. Stays here because it affects normal
//     list organization too, not just pack mode.
//   - Sharing: PrivacyPanel's inline body (toggle + url + Copy when
//     public).
//
// "Add ready checks" used to live here as a third toggle, but it is a
// pack-mode-only feature and the panel itself is hidden in pack mode
// (see ListDocumentToolbar / MobileListActionBar). The toggle now lives
// inline at the top of PackingProgress, the one surface where the user
// is actually in pack mode and can see/use the second progress bar.
//
// Actions reuse the shared useCurrentListActions hook so the /lists
// card kebab and this panel call the same renameMut/duplicateMut/
// deleteListMut/exportCsv handlers - one canonical code path, multiple
// entry points.
//
// Rename UI: clicking "Rename" replaces the menu item with an inline
// input. Enter saves, Escape cancels, blur saves (matching the same
// keyboard semantics as InlineTitle, the desktop pencil affordance).
// Same renameMut runs in either path.
//
// Mounted inside ListSettingsButton's popover at md+ and inside a
// Modal on mobile via MobileListActionBar's Options slot. Both mount
// points are themselves suppressed in pack mode.
export default function ListSettingsPanel({ list }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''

  const groupWornMut = useMutation({
    mutationFn: () => updateList(list.id, { group_worn: !list.group_worn }),
    ...makeOptimisticUpdate<List, void>({
      qc,
      queryKey: queryKeys.lists(),
      id: () => list.id,
      apply: (item) => ({ ...item, group_worn: !item.group_worn }),
    }),
  })

  const { renameMut, duplicateMut, deleteListMut, exportCsv } = useCurrentListActions(userId)

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
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming])

  function startRename() {
    setDraft(list.name)
    setRenaming(true)
  }

  function commitRename() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== list.name) {
      renameMut.mutate({ id: list.id, name: trimmed })
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
        <span className={PANEL_TOGGLE_LABEL}>Group worn items</span>
        <ToggleSwitch
          checked={list.group_worn}
          onChange={() => groupWornMut.mutate()}
          ariaLabel="Group worn items"
        />
      </div>
      <PrivacyPanel list={list} />

      {/* Actions section. The -mx-3 spans the popover's p-3 padding so
          the divider and action rows go edge-to-edge while RowMenuItem's
          own px-3 keeps the visible content inset where the toggles
          above sit.
          No role="menu" here: when renaming, the Rename row swaps for
          a text input, which is not a valid ARIA menu child. This
          surface is a settings panel, not a keyboard-navigable menu,
          so each action is a plain button (inMenu={false}). The card
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
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') cancelRename()
                }}
                onBlur={commitRename}
                maxLength={120}
                aria-label="List name"
                className={`w-full rounded border border-blue-400 px-2 py-1 text-sm ${INLINE_EDIT_FOCUS_RING}`}
              />
            </div>
          ) : (
            <RowMenuItem
              icon={<Pencil size={13} />}
              onClick={startRename}
              inMenu={false}
            >
              Rename
            </RowMenuItem>
          )}
          <RowMenuItem
            icon={<Copy size={13} />}
            onClick={() => duplicateMut.mutate(list)}
            inMenu={false}
          >
            Duplicate
          </RowMenuItem>
          <RowMenuItem
            icon={<Download size={13} />}
            onClick={() => exportCsv(list)}
            inMenu={false}
          >
            Export CSV
          </RowMenuItem>
          <RowMenuItem
            icon={<Trash2 size={13} />}
            tone="danger"
            onClick={() => setConfirmingDelete(true)}
            inMenu={false}
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
            // Navigate away from the now-deleted list. The optimistic
            // delete removes it from cache immediately; without
            // navigating, the user lands on ListDetailPage's
            // "List not found" terminal state.
            deleteListMut.mutate(list.id, {
              onSuccess: () => navigate('/lists'),
            })
          }}
        />
      )}
    </div>
  )
}
