import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { isCategoryCapError } from './categories'
import {
  isAnyUniqueViolation,
  isForeignKeyViolation,
  isPackRankRangeError,
  isPackRankUniqueViolation,
  isTriggerAbort,
  isUniqueViolation,
} from './db-errors'
import { isCapError } from './gear-items'

// Root-cause-only matching: the drizzle wrapper message embeds bound params,
// so user-controlled text that LOOKS like a trigger/constraint message must
// never classify an unrelated failure.
// The live route tests pin the real error shapes; these pin the matcher logic
// itself.

// A real better-sqlite3 error: SQLite's message plus its extended result code.
function sqliteError(message: string, code: string): Error {
  return new Database.SqliteError(message, code)
}

// Drizzle wraps the driver error; its own message embeds the query and params.
// A plain string root is an error with no SQLite code at all.
function wrapped(root: Error | string, wrapperMsg: string): Error {
  const cause = typeof root === 'string' ? new Error(root) : root
  return new Error(wrapperMsg, { cause })
}

describe('isTriggerAbort', () => {
  it('matches the real trigger shape at the root', () => {
    const err = wrapped(
      sqliteError('list cap exceeded (100 per user)', 'SQLITE_CONSTRAINT_TRIGGER'),
      'Failed query: insert into "lists" ...',
    )
    expect(isTriggerAbort(err, 'list cap exceeded')).toBe(true)
  })

  it('requires the trigger constraint class, not just the text', () => {
    const err = wrapped(
      'list cap exceeded (100 per user)', // no SQLite code at all
      'Failed query: ...',
    )
    expect(isTriggerAbort(err, 'list cap exceeded')).toBe(false)
  })

  it('distinguishes markers: a gear cap error is not a list cap error', () => {
    const err = wrapped(
      sqliteError('gear item cap exceeded (500 per user)', 'SQLITE_CONSTRAINT_TRIGGER'),
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
      sqliteError('UNIQUE constraint failed: lists.slug', 'SQLITE_CONSTRAINT_UNIQUE'),
      'Failed query: insert into "lists" ...',
    )
    expect(isUniqueViolation(err, 'lists.slug')).toBe(true)
    expect(isUniqueViolation(err, 'lists.id')).toBe(false)
  })
})

// The matchers below decide user-facing statuses with no other check behind
// them: isPackRankUniqueViolation decides the pack-order and food 409s,
// isAnyUniqueViolation the list-item 409, and
// isForeignKeyViolation opens the precheck-race recovery path. Same discipline as above: real root shapes match here, and the
// wrapper forgeries are in the table at the end.

describe('isAnyUniqueViolation', () => {
  it('matches a unique violation on ANY column at the root', () => {
    const err = wrapped(
      sqliteError('UNIQUE constraint failed: list_items.list_id, list_items.packing_location_id, list_items.pack_sort_order', 'SQLITE_CONSTRAINT_UNIQUE'),
      'Failed query: update "list_items" ...',
    )
    expect(isAnyUniqueViolation(err)).toBe(true)
  })

  it('rejects non-errors and unrelated errors', () => {
    expect(isAnyUniqueViolation(new Error('network exploded'))).toBe(false)
    expect(isAnyUniqueViolation(null)).toBe(false)
  })
})

describe('isPackRankUniqueViolation', () => {
  it.each([
    'UNIQUE constraint failed: list_items.list_id, list_items.packing_location_id, list_items.pack_sort_order',
    'UNIQUE constraint failed: list_items.list_id, list_items.pack_sort_order',
    'UNIQUE constraint failed: list_food_items.list_id, list_food_items.packing_location_id, list_food_items.pack_sort_order',
    'UNIQUE constraint failed: list_food_items.list_id, list_food_items.pack_sort_order',
  ])('matches the pack-rank index %s', (message) => {
    expect(
      isPackRankUniqueViolation(
        wrapped(sqliteError(message, 'SQLITE_CONSTRAINT_UNIQUE'), 'Failed query: ...'),
      ),
    ).toBe(true)
  })

  it('rejects every other unique index and every other constraint', () => {
    for (const err of [
      sqliteError('UNIQUE constraint failed: lists.slug', 'SQLITE_CONSTRAINT_UNIQUE'),
      sqliteError('UNIQUE constraint failed: list_items.pack_sort_order', 'SQLITE_CONSTRAINT_UNIQUE'),
      sqliteError('UNIQUE constraint failed: packing_locations.container_list_item_id', 'SQLITE_CONSTRAINT_UNIQUE'),
      sqliteError('NOT NULL constraint failed: list_items.pack_sort_order', 'SQLITE_CONSTRAINT_NOTNULL'),
      // The right text without SQLite's code: user text in a wrapper, or a
      // trigger RAISE, is not the index.
      sqliteError('UNIQUE constraint failed: list_items.list_id, list_items.pack_sort_order', 'SQLITE_CONSTRAINT_TRIGGER'),
    ]) {
      expect(isPackRankUniqueViolation(wrapped(err, 'Failed query: ...'))).toBe(false)
    }
    expect(isPackRankUniqueViolation(null)).toBe(false)
  })
})

describe('isForeignKeyViolation', () => {
  it('matches the real (anonymous) FK shape at the root', () => {
    const err = wrapped(
      sqliteError('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY'),
      'Failed query: insert into "list_food_item_slots" ...',
    )
    expect(isForeignKeyViolation(err)).toBe(true)
  })

  it('rejects a plain error with no constraint marker', () => {
    expect(isForeignKeyViolation(new Error('FOREIGN KEY constraint failed'))).toBe(false)
  })
})

describe('isPackRankRangeError', () => {
  it('matches the 0019 range trigger at the root', () => {
    const err = wrapped(
      sqliteError('pack_sort_order out of range', 'SQLITE_CONSTRAINT_TRIGGER'),
      'Failed query: update "list_items" ...',
    )
    expect(isPackRankRangeError(err)).toBe(true)
  })

  it('requires the trigger class, not just the words', () => {
    expect(isPackRankRangeError(new Error('pack_sort_order out of range'))).toBe(false)
  })
})

// Every matcher, the same forgery: the root is an unrelated constraint
// failure, and the matcher's own text sits only in the wrapper's bound params
// (a user can name an item anything). Each row first proves the text matches
// at the root, so a matcher that never matches cannot pass the second half.
// Non-errors and unrelated errors never match either.
// isCapError and isCategoryCapError are one-line isTriggerAbort calls in the
// repos; their rows prove each still matches only the root.
const FK_ROOT = sqliteError('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY')
const UNIQUE_ROOT = sqliteError('UNIQUE constraint failed: lists.slug', 'SQLITE_CONSTRAINT_UNIQUE')

describe('wrapper params never classify an error', () => {
  it.each([
    { name: 'isTriggerAbort', match: (e: unknown) => isTriggerAbort(e, 'list cap exceeded'), text: sqliteError('list cap exceeded (100 per user)', 'SQLITE_CONSTRAINT_TRIGGER'), other: FK_ROOT },
    { name: 'isCapError', match: isCapError, text: sqliteError('gear item cap exceeded (500 per user)', 'SQLITE_CONSTRAINT_TRIGGER'), other: FK_ROOT },
    { name: 'isCategoryCapError', match: isCategoryCapError, text: sqliteError('category cap exceeded (500 per user)', 'SQLITE_CONSTRAINT_TRIGGER'), other: FK_ROOT },
    { name: 'isPackRankRangeError', match: isPackRankRangeError, text: sqliteError('pack_sort_order out of range', 'SQLITE_CONSTRAINT_TRIGGER'), other: FK_ROOT },
    { name: 'isUniqueViolation', match: (e: unknown) => isUniqueViolation(e, 'lists.slug'), text: sqliteError('UNIQUE constraint failed: lists.slug', 'SQLITE_CONSTRAINT_UNIQUE'), other: FK_ROOT },
    { name: 'isAnyUniqueViolation', match: isAnyUniqueViolation, text: sqliteError('UNIQUE constraint failed: lists.slug', 'SQLITE_CONSTRAINT_UNIQUE'), other: FK_ROOT },
    { name: 'isForeignKeyViolation', match: isForeignKeyViolation, text: sqliteError('FOREIGN KEY constraint failed', 'SQLITE_CONSTRAINT_FOREIGNKEY'), other: UNIQUE_ROOT },
  ])('$name ignores its text in wrapper params', ({ match, text, other }) => {
    expect(match(wrapped(text, 'Failed query: ...'))).toBe(true)
    expect(match(wrapped(other, `Failed query: insert ... params: abc,${text.message},0`))).toBe(false)
    expect(match(null)).toBe(false)
    expect(match(new Error('unrelated'))).toBe(false)
  })
})
