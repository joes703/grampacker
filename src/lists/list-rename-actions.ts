import type { List } from '../lib/types'
import type { ListRowActions } from './ListRow'

export type RenamingDialog = { type: 'renaming'; list: List; draft: string }

// The rename half of a list row's actions, shared by ListsPage and
// DesktopListsPanel. Each surface keeps rename inside its own dialog union
// (one transient surface at a time), so this takes that state and setter
// rather than owning any: the open rename is the RenamingDialog variant.
// The rest of the row's actions differ per surface (the page shares, the
// panel navigates after a delete) and stay there.
//
// Submit trims the draft and writes only a real change; blank or unchanged
// just closes.
export function listRenameActions(
  list: List,
  dialog: { type: string } | null,
  setDialog: (next: RenamingDialog | null) => void,
  rename: (vars: { id: string; name: string }) => void,
): Pick<
  ListRowActions,
  | 'renaming'
  | 'renameDraft'
  | 'onRenameDraftChange'
  | 'onStartRename'
  | 'onSubmitRename'
  | 'onCancelRename'
> {
  const open = isRenaming(dialog) && dialog.list.id === list.id ? dialog : null
  return {
    renaming: open !== null,
    renameDraft: open?.draft ?? '',
    onRenameDraftChange: (draft) => setDialog({ type: 'renaming', list, draft }),
    onStartRename: () => setDialog({ type: 'renaming', list, draft: list.name }),
    onSubmitRename: () => {
      if (!isRenaming(dialog)) return
      const trimmed = dialog.draft.trim()
      if (trimmed && trimmed !== list.name) rename({ id: list.id, name: trimmed })
      setDialog(null)
    },
    onCancelRename: () => setDialog(null),
  }
}

function isRenaming(dialog: { type: string } | null): dialog is RenamingDialog {
  return dialog?.type === 'renaming'
}
