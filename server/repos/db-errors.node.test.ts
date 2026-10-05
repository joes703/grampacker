import { describe, expect, it } from 'vitest'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
  isPackGuardViolation,
  isPackRankRangeError,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'

// Root-cause-only matching: the drizzle wrapper message embeds bound params,
// so user-controlled text that LOOKS like a trigger/constraint message must
// never classify an unrelated failure.
// The live route tests pin the real workerd error shapes; these pin the
// matcher logic itself.

function wrapped(rootMsg: string, wrapperMsg: string): Error {
  const root = new Error(rootMsg)
  const d1 = new Error('D1_ERROR: something failed', { cause: root })
  return new Error(wrapperMsg, { cause: d1 })
}

describe('isTriggerAbort', () => {
  it('matches the real trigger shape at the root', () => {
    const err = wrapped(
      'list cap exceeded (100 per user): SQLITE_CONSTRAINT_TRIGGER',
      'Failed query: insert into "lists" ...',
    )
    expect(isTriggerAbort(err, 'list cap exceeded')).toBe(true)
  })

  it('ignores the marker when it only appears in wrapper params', () => {
    const err = wrapped(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY',
      'Failed query: insert into "lists" ... params: list cap exceeded (100 per user): SQLITE_CONSTRAINT_TRIGGER',
    )
    expect(isTriggerAbort(err, 'list cap exceeded')).toBe(false)
  })

  it('requires the trigger constraint class, not just the text', () => {
    const err = wrapped(
      'list cap exceeded (100 per user)', // no SQLITE_CONSTRAINT_TRIGGER
      'Failed query: ...',
    )
    expect(isTriggerAbort(err, 'list cap exceeded')).toBe(false)
  })

  it('distinguishes markers: a gear cap error is not a list cap error', () => {
    const err = wrapped(
      'gear item cap exceeded (500 per user): SQLITE_CONSTRAINT_TRIGGER',
      'Failed query: ...',
    )
    expect(isTriggerAbort(err, 'gear item cap exceeded')).toBe(true)
    expect(isTriggerAbort(err, 'list cap exceeded')).toBe(false)
    expect(isTriggerAbort(err, 'list item cap exceeded')).toBe(false)
  })

  it('non-Error values never match', () => {
    expect(isTriggerAbort('list cap exceeded', 'list cap exceeded')).toBe(false)
    expect(isTriggerAbort(null, 'list cap exceeded')).toBe(false)
  })
})

describe('isUniqueViolation', () => {
  it('matches the named column at the root', () => {
    const err = wrapped(
      'UNIQUE constraint failed: lists.slug: SQLITE_CONSTRAINT',
      'Failed query: insert into "lists" ...',
    )
    expect(isUniqueViolation(err, 'lists.slug')).toBe(true)
    expect(isUniqueViolation(err, 'lists.id')).toBe(false)
  })

  it('ignores column names that only appear in wrapper params', () => {
    const err = wrapped(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY',
      'Failed query: ... params: UNIQUE constraint failed: lists.slug: SQLITE_CONSTRAINT',
    )
    expect(isUniqueViolation(err, 'lists.slug')).toBe(false)
  })
})

// The matchers below decide user-facing statuses with no other check behind
// them: isAnyUniqueViolation and isPackGuardViolation together decide the
// pack-order 409, and isForeignKeyViolation opens the precheck-race recovery
// path. Same discipline as above: real root shapes match, wrapper forgeries
// do not.

describe('isAnyUniqueViolation', () => {
  it('matches a unique violation on ANY column at the root', () => {
    const err = wrapped(
      'UNIQUE constraint failed: list_items.list_id, list_items.packing_location_id, list_items.pack_sort_order: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
      'Failed query: update "list_items" ...',
    )
    expect(isAnyUniqueViolation(err)).toBe(true)
  })

  it('ignores unique-violation text that only appears in wrapper params', () => {
    const err = wrapped(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
      'Failed query: ... params: UNIQUE constraint failed: lists.slug: SQLITE_CONSTRAINT',
    )
    expect(isAnyUniqueViolation(err)).toBe(false)
  })

  it('rejects non-errors and unrelated errors', () => {
    expect(isAnyUniqueViolation(new Error('network exploded'))).toBe(false)
    expect(isAnyUniqueViolation(null)).toBe(false)
  })
})

describe('isForeignKeyViolation', () => {
  it('matches the real (anonymous) FK shape at the root', () => {
    const err = wrapped(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
      'Failed query: insert into "list_food_item_slots" ...',
    )
    expect(isForeignKeyViolation(err)).toBe(true)
  })

  it('ignores FK text that only appears in wrapper params', () => {
    const err = wrapped(
      'UNIQUE constraint failed: lists.slug: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)',
      'Failed query: ... params: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT',
    )
    expect(isForeignKeyViolation(err)).toBe(false)
  })

  it('rejects a plain error with no constraint marker', () => {
    expect(isForeignKeyViolation(new Error('FOREIGN KEY constraint failed'))).toBe(false)
  })
})

describe('isPackGuardViolation', () => {
  it('matches only the guard table own column', () => {
    const guard = wrapped(
      'NOT NULL constraint failed: _pack_reorder_guard.ok: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)',
      'Failed query: insert into "_pack_reorder_guard" ...',
    )
    expect(isPackGuardViolation(guard)).toBe(true)

    // An unrelated NOT NULL in the same batch must NOT read as a lost race.
    const other = wrapped(
      'NOT NULL constraint failed: list_items.quantity: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)',
      'Failed query: update "list_items" ...',
    )
    expect(isPackGuardViolation(other)).toBe(false)
  })

  it('ignores guard text that only appears in wrapper params', () => {
    const err = wrapped(
      'FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)',
      'Failed query: ... params: NOT NULL constraint failed: _pack_reorder_guard.ok: SQLITE_CONSTRAINT',
    )
    expect(isPackGuardViolation(err)).toBe(false)
  })
})

describe('isPackRankRangeError', () => {
  it('matches the 0019 range trigger at the root', () => {
    const err = wrapped(
      'pack_sort_order out of range: SQLITE_CONSTRAINT_TRIGGER',
      'Failed query: update "list_items" ...',
    )
    expect(isPackRankRangeError(err)).toBe(true)
  })

  it('requires the trigger class, not just the words', () => {
    expect(isPackRankRangeError(new Error('pack_sort_order out of range'))).toBe(false)
  })
})
