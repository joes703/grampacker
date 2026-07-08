import { describe, expect, it } from 'vitest'
import { isTriggerAbort, isUniqueViolation } from './db-errors'

// Root-cause-only matching (Codex finding, PR #14): the drizzle wrapper
// message embeds bound params, so user-controlled text that LOOKS like a
// trigger/constraint message must never classify an unrelated failure.
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
