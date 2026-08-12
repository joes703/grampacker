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

const OWNER = 'user-a'
const OTHER = 'user-b'

beforeEach(() => {
  localStorage.clear()
})

describe('readLastListPath', () => {
  it('returns null when storage is empty', () => {
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('returns a valid bare path round-tripped through write for the same owner', () => {
    writeLastListPath(BARE_PATH, OWNER)
    expect(readLastListPath(OWNER)).toBe(BARE_PATH)
  })

  it('returns a valid pack-mode path round-tripped through write for the same owner', () => {
    writeLastListPath(PACK_PATH, OWNER)
    expect(readLastListPath(OWNER)).toBe(PACK_PATH)
  })

  it('round-trips a food view path', () => {
    writeLastListPath(`/lists/${UUID}/food`, OWNER)
    expect(readLastListPath(OWNER)).toBe(`/lists/${UUID}/food`)
  })

  it('returns null for a DIFFERENT owner (the cross-account guard)', () => {
    // The reason this module is owner-tagged: a pointer A wrote must never be
    // followed by B. A fresh document (magic-link switch, or a lapsed cookie on
    // a shared browser) lands B on /sign-in with A's pointer still in
    // localStorage; RootRedirect must treat it as a miss, not route B to A's
    // list URL.
    writeLastListPath(BARE_PATH, OWNER)
    expect(readLastListPath(OTHER)).toBeNull()
  })

  it('returns null when no owner id is supplied', () => {
    // An unauthenticated read can never surface a path, even one that exists.
    writeLastListPath(BARE_PATH, OWNER)
    expect(readLastListPath(null)).toBeNull()
    expect(readLastListPath(undefined)).toBeNull()
  })

  it('returns null when localStorage holds a tampered/invalid path for the owner', () => {
    // A value whose owner matches but whose path is not a strict /lists/<uuid>
    // must still be rejected - the owner tag does not relax path validation.
    localStorage.setItem('lastListPath', JSON.stringify({ p: '/evil.example.com', o: OWNER }))
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('rejects a path with extra query keys even for the right owner', () => {
    localStorage.setItem(
      'lastListPath',
      JSON.stringify({ p: `${LEGACY_PACK_PATH}&extra=1`, o: OWNER }),
    )
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('rejects a path with a non-UUID id segment', () => {
    localStorage.setItem('lastListPath', JSON.stringify({ p: '/lists/not-a-uuid', o: OWNER }))
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('treats a pre-owner-tag bare string as a miss (self-heals)', () => {
    // Values written before this shipped are a bare path with no owner. They
    // can't be attributed to an account, so following one is exactly the bug -
    // it must read as a miss. JSON.parse throws on the bare string; the read
    // swallows it. The next write replaces it with a tagged value.
    localStorage.setItem('lastListPath', BARE_PATH)
    expect(readLastListPath(OWNER)).toBeNull()
  })

  it('treats a legacy lastListId value as a miss (no longer migrated)', () => {
    // Owner-tagging retired the old-app migrations: a migrated value would carry
    // no owner and be rejected anyway, so an unattributable legacy id is simply
    // a miss now.
    localStorage.setItem('lastListId', UUID)
    expect(readLastListPath(OWNER)).toBeNull()
  })
})

describe('writeLastListPath', () => {
  it('stores a valid bare path tagged with its owner', () => {
    writeLastListPath(BARE_PATH, OWNER)
    expect(JSON.parse(localStorage.getItem('lastListPath')!)).toEqual({ p: BARE_PATH, o: OWNER })
  })

  it('stores a valid pack-mode path tagged with its owner', () => {
    writeLastListPath(PACK_PATH, OWNER)
    expect(JSON.parse(localStorage.getItem('lastListPath')!)).toEqual({ p: PACK_PATH, o: OWNER })
  })

  it('refuses to write without an owner id', () => {
    // An untagged pointer could never be read back safely, so it is never
    // written in the first place.
    writeLastListPath(BARE_PATH, null)
    writeLastListPath(BARE_PATH, undefined)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('refuses to store an organize path now that the view is gone', () => {
    writeLastListPath(ORGANIZE_PATH, OWNER)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('no-ops on an arbitrary path (does not store)', () => {
    writeLastListPath('/settings', OWNER)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('no-ops on a path with extra query keys', () => {
    writeLastListPath(`${BARE_PATH}?other=1`, OWNER)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('no-ops on the legacy pack-mode query path', () => {
    writeLastListPath(LEGACY_PACK_PATH, OWNER)
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('overwrites a previously stored path for the same owner', () => {
    writeLastListPath(BARE_PATH, OWNER)
    writeLastListPath(PACK_PATH, OWNER)
    expect(readLastListPath(OWNER)).toBe(PACK_PATH)
  })

  it('scrubs the legacy lastListId key so an old bundle cannot resurrect it', () => {
    // Mixed-version defense: an OLD or rolled-back bundle reads our JSON as
    // invalid, then falls back to `lastListId` and follows it with no owner
    // check. A write must therefore remove that permanently-unattributable key,
    // not just overwrite lastListPath.
    localStorage.setItem('lastListId', UUID)
    writeLastListPath(PACK_PATH, OWNER)
    expect(localStorage.getItem('lastListId')).toBeNull()
    expect(readLastListPath(OWNER)).toBe(PACK_PATH)
  })

  it('reassigns ownership when a different account writes', () => {
    // A shared browser: B visiting a list overwrites A's pointer with B's own.
    // Nothing here has to remember to clear A's - the write re-tags.
    writeLastListPath(BARE_PATH, OWNER)
    writeLastListPath(PACK_PATH, OTHER)
    expect(readLastListPath(OWNER)).toBeNull()
    expect(readLastListPath(OTHER)).toBe(PACK_PATH)
  })
})

describe('clearLastListPath', () => {
  it('removes the stored path', () => {
    writeLastListPath(BARE_PATH, OWNER)
    clearLastListPath()
    expect(localStorage.getItem('lastListPath')).toBeNull()
  })

  it('also removes the legacy lastListId key', () => {
    // Account-deletion teardown depends on this: a clear must scrub both keys so
    // nothing about the deleted account lingers in this browser.
    writeLastListPath(BARE_PATH, OWNER)
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

  it('extracts the list id from a food path', () => {
    expect(getListIdFromListPath(`/lists/${UUID}/food`)).toBe(UUID)
  })

  it('does not extract a UUID from a retired organize path', () => {
    // This helper drives ListDetailPage's cache self-heal, which compares the
    // STORED path against the current route. A stored path is always a strict
    // /lists/<uuid>[/pack]; treating an organize path as valid here would let
    // the self-heal match (and then clear) a cache entry it should never see.
    expect(getListIdFromListPath(ORGANIZE_PATH)).toBeNull()
  })

  it('returns null for an invalid path', () => {
    expect(getListIdFromListPath('/lists/not-a-uuid')).toBeNull()
    expect(getListIdFromListPath('/settings')).toBeNull()
    expect(getListIdFromListPath('')).toBeNull()
  })
})
