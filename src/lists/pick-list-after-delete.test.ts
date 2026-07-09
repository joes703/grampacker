import { describe, it, expect } from 'vitest'
import { pickListAfterDelete } from './pick-list-after-delete'

// Pure-helper coverage for the delete-current-list successor rule used by
// DesktopListsPanel. The shape this codebase historically gets wrong is
// "passing test on table A tells you nothing about table B" — same risk
// applies to "passing test on the middle case tells you nothing about
// head/tail/only-one." Cover all four explicitly.

const lists = [
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
  { id: 'd' },
] as const

describe('pickListAfterDelete', () => {
  it('returns null when the deleted list is not the currently open one', () => {
    // Deleting some other row from the /lists card page or a panel that
    // happens to show non-current lists should not navigate. The current
    // list stays open.
    expect(pickListAfterDelete(lists, 'b', 'c')).toBe(null)
  })

  it('navigates to the next list when deleting the current head', () => {
    // a is current and first; next is b.
    expect(pickListAfterDelete(lists, 'a', 'a')).toBe('/lists/b')
  })

  it('navigates to the next list when deleting a middle current list', () => {
    // b is current; next is c (preferred over a).
    expect(pickListAfterDelete(lists, 'b', 'b')).toBe('/lists/c')
  })

  it('navigates to the previous list when deleting the current tail', () => {
    // d is current and last; no next exists, so fall back to c.
    expect(pickListAfterDelete(lists, 'd', 'd')).toBe('/lists/c')
  })

  it('navigates to /lists when deleting the only remaining list', () => {
    // The empty/new/import state lives on /lists for now; see the file
    // header TODO for the planned in-workspace empty state.
    expect(pickListAfterDelete([{ id: 'solo' }], 'solo', 'solo')).toBe('/lists')
  })

  it('falls back to /lists when the deleted id is already absent from the snapshot', () => {
    // Defensive case: a caller could pass a lists array that has already
    // been pruned (e.g. snapshotted after an earlier optimistic update).
    // We should NOT navigate to a stale neighbor that happened to share
    // an index; bounce to /lists instead.
    expect(pickListAfterDelete(lists, 'z', 'z')).toBe('/lists')
  })
})
