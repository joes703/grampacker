// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  readLastListPath,
  writeLastListPath,
  clearLastListPath,
  getListIdFromListPath,
} from './last-list-path'

const UUID = '11111111-2222-3333-4444-555555555555'
const BARE_PATH = `/lists/${UUID}`
const PACK_PATH = `/lists/${UUID}/pack`
const ORGANIZE_PATH = `/lists/${UUID}/organize`
const LEGACY_PACK_PATH = `/lists/${UUID}?mode=pack`

beforeEach(() => {
  localStorage.clear()
})

describe('readLastListPath', () => {
  it('returns null when storage is empty', () => {
    expect(readLastListPath()).toBeNull()
  })

  it('returns a valid bare path round-tripped through write', () => {
    writeLastListPath(BARE_PATH)
    expect(readLastListPath()).toBe(BARE_PATH)
  })

  it('returns a valid pack-mode path round-tripped through write', () => {
    writeLastListPath(PACK_PATH)
    expect(readLastListPath()).toBe(PACK_PATH)
  })

  it('migrates a stored organize path to the pack route', () => {
    // Organize merged into Pack. A stored organize path must NOT simply fail
    // validation: readLastListPath would return null, RootRedirect would skip
    // its fast path, and the user would land on whichever list was updated
    // most recently, in the wrong view. So it migrates, like ?mode=pack does.
    localStorage.setItem('lastListPath', ORGANIZE_PATH)
    expect(readLastListPath()).toBe(PACK_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(PACK_PATH)
  })

  it('returns null when localStorage holds a tampered/invalid value', () => {
    // Bypass write-time validation by setting directly.
    localStorage.setItem('lastListPath', '/evil.example.com')
    expect(readLastListPath()).toBeNull()
  })

  it('rejects paths with extra query keys', () => {
    localStorage.setItem('lastListPath', `${LEGACY_PACK_PATH}&extra=1`)
    expect(readLastListPath()).toBeNull()
  })

  it('migrates the nested organize route too', () => {
    // Both retired shapes shipped, so both have to survive the merge.
    localStorage.setItem('lastListPath', `${PACK_PATH}/organize`)
    expect(readLastListPath()).toBe(PACK_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(PACK_PATH)
  })

  it('migrates the legacy pack-mode query path to the pack route', () => {
    localStorage.setItem('lastListPath', LEGACY_PACK_PATH)
    expect(readLastListPath()).toBe(PACK_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(PACK_PATH)
  })

  it('rejects paths with a non-UUID id segment', () => {
    localStorage.setItem('lastListPath', '/lists/not-a-uuid')
    expect(readLastListPath()).toBeNull()
  })
})

describe('writeLastListPath', () => {
  it('stores a valid bare path', () => {
    writeLastListPath(BARE_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(BARE_PATH)
  })

  it('stores a valid pack-mode path', () => {
    writeLastListPath(PACK_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(PACK_PATH)
  })

  it('refuses to store an organize path now that the view is gone', () => {
    // Reading migrates an OLD value; writing a new one must not resurrect the
    // dead route. Nothing in the app produces this path any more.
    writeLastListPath(ORGANIZE_PATH)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('no-ops on an arbitrary path (does not store)', () => {
    writeLastListPath('/settings')
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('no-ops on a path with extra query keys', () => {
    writeLastListPath(`${BARE_PATH}?other=1`)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('no-ops on the legacy pack-mode query path', () => {
    writeLastListPath(LEGACY_PACK_PATH)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('overwrites a previously stored path', () => {
    writeLastListPath(BARE_PATH)
    writeLastListPath(PACK_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(PACK_PATH)
  })
})

describe('clearLastListPath', () => {
  it('removes the stored path', () => {
    writeLastListPath(BARE_PATH)
    clearLastListPath()
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('also removes the legacy lastListId key', () => {
    // Account-deletion teardown depends on this: a clear that left the legacy
    // key behind would let a deleted account's list id migrate back into the
    // new key on the next read. Clear must scrub both.
    localStorage.setItem('lastListPath', BARE_PATH)
    localStorage.setItem('lastListId', UUID)
    clearLastListPath()
    expect(localStorage.getItem('lastListPath')).toBeNull()
    expect(localStorage.getItem('lastListId')).toBeNull()
  })
})

describe('getListIdFromListPath', () => {
  it('extracts the UUID from a bare path', () => {
    expect(getListIdFromListPath(BARE_PATH)).toBe(UUID)
  })

  it('extracts the UUID from a pack-mode path', () => {
    expect(getListIdFromListPath(PACK_PATH)).toBe(UUID)
  })

  it('does not extract a UUID from a retired organize path', () => {
    // This helper drives ListDetailPage's cache self-heal, which compares the
    // STORED path against the current route. Stored paths are migrated to
    // /pack on read, so an organize path never reaches it - and treating one
    // as valid here would let the self-heal match (and then clear) a cache
    // entry it should never have seen.
    expect(getListIdFromListPath(ORGANIZE_PATH)).toBeNull()
  })

  it('returns null for an invalid path', () => {
    expect(getListIdFromListPath('/lists/not-a-uuid')).toBeNull()
    expect(getListIdFromListPath('/settings')).toBeNull()
    expect(getListIdFromListPath('')).toBeNull()
  })
})

describe('legacy lastListId migration', () => {
  it('promotes a valid legacy id to /lists/<id> and clears the old key', () => {
    localStorage.setItem('lastListId', UUID)
    const result = readLastListPath()
    expect(result).toBe(BARE_PATH)
    expect(localStorage.getItem('lastListPath')).toBe(BARE_PATH)
    expect(localStorage.getItem('lastListId')).toBeNull()
  })

  it('does not migrate when the legacy value is not a valid UUID', () => {
    localStorage.setItem('lastListId', 'not-a-uuid')
    expect(readLastListPath()).toBeNull()
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('prefers the new key when both are present', () => {
    localStorage.setItem('lastListPath', PACK_PATH)
    localStorage.setItem('lastListId', UUID)
    expect(readLastListPath()).toBe(PACK_PATH)
    // Legacy key is untouched when the new key already satisfies the read.
    expect(localStorage.getItem('lastListId')).toBe(UUID)
  })
})
