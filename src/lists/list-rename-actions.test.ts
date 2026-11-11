import { describe, expect, it, vi } from 'vitest'
import type { List } from '../lib/types'
import { listRenameActions, type RenamingDialog } from './list-rename-actions'

const list: List = {
  id: 'list-1',
  name: 'Trip',
  description: null,
  slug: 'abc123',
  isShared: false,
  isDraft: true,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}
const other: List = { ...list, id: 'list-2', name: 'Other' }

function setup(dialog: RenamingDialog | { type: 'confirm-delete' } | null) {
  const setDialog = vi.fn()
  const rename = vi.fn()
  return { setDialog, rename, actions: listRenameActions(list, dialog, setDialog, rename) }
}

describe('listRenameActions', () => {
  it('is renaming only while the open rename is for this list', () => {
    expect(setup({ type: 'renaming', list, draft: 'x' }).actions).toMatchObject({
      renaming: true,
      renameDraft: 'x',
    })
    expect(setup({ type: 'renaming', list: other, draft: 'x' }).actions).toMatchObject({
      renaming: false,
      renameDraft: '',
    })
    expect(setup({ type: 'confirm-delete' }).actions.renaming).toBe(false)
  })

  it('starts from the current name and tracks the draft', () => {
    const { setDialog, actions } = setup(null)
    actions.onStartRename()
    expect(setDialog).toHaveBeenLastCalledWith({ type: 'renaming', list, draft: 'Trip' })
    actions.onRenameDraftChange('Trip 2')
    expect(setDialog).toHaveBeenLastCalledWith({ type: 'renaming', list, draft: 'Trip 2' })
  })

  it('submits the trimmed draft and closes', () => {
    const { setDialog, rename, actions } = setup({ type: 'renaming', list, draft: '  Trip 2  ' })
    actions.onSubmitRename()
    expect(rename).toHaveBeenCalledWith({ id: 'list-1', name: 'Trip 2' })
    expect(setDialog).toHaveBeenLastCalledWith(null)
  })

  it('closes without a write when the draft is blank or unchanged', () => {
    for (const draft of ['   ', 'Trip', ' Trip ']) {
      const { setDialog, rename, actions } = setup({ type: 'renaming', list, draft })
      actions.onSubmitRename()
      expect(rename).not.toHaveBeenCalled()
      expect(setDialog).toHaveBeenLastCalledWith(null)
    }
  })

  it('cancel closes without a write', () => {
    const { setDialog, rename, actions } = setup({ type: 'renaming', list, draft: 'Trip 2' })
    actions.onCancelRename()
    expect(rename).not.toHaveBeenCalled()
    expect(setDialog).toHaveBeenLastCalledWith(null)
  })
})
