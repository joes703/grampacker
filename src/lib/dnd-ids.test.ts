import { describe, it, expect } from 'vitest'
import { makeDnDId, parseDnDId } from './dnd-ids'

// DND_KINDS is module-private — tests enumerate the public contract via
// valid makeDnDId calls. The four kinds today are 'category', 'gear-item',
// 'item', 'list-card'. If a kind is renamed/added/removed, makeDnDId's
// type narrows the test fixtures and a stale string would fail to compile.
describe('parseDnDId', () => {
  it('round-trips every valid kind through makeDnDId', () => {
    const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

    expect(parseDnDId(makeDnDId('category', uuid))).toEqual({
      kind: 'category',
      id: uuid,
    })
    expect(parseDnDId(makeDnDId('gear-item', uuid))).toEqual({
      kind: 'gear-item',
      id: uuid,
    })
    expect(parseDnDId(makeDnDId('item', uuid))).toEqual({
      kind: 'item',
      id: uuid,
    })
    expect(parseDnDId(makeDnDId('list-card', uuid))).toEqual({
      kind: 'list-card',
      id: uuid,
    })
  })

  it('returns null for empty id after the colon', () => {
    expect(parseDnDId('category:')).toBeNull()
  })

  it('returns null when no colon delimiter is present', () => {
    expect(parseDnDId('justanid')).toBeNull()
  })

  it('returns null for an unknown kind prefix (covers the isDnDIdKind guard)', () => {
    expect(parseDnDId('badkind:abc-def-ghi')).toBeNull()
  })

  it('treats only the first colon as the delimiter (uuids never contain colons; contract test)', () => {
    expect(parseDnDId('category:abc:def')).toEqual({
      kind: 'category',
      id: 'abc:def',
    })
  })
})
