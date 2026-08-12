import { describe, expect, it, vi } from 'vitest'
import type { Db } from '../db'
import { createPackingLocationsRepo } from './packing-locations'

describe('createPackingLocationsRepo', () => {
  it('maps the container ownership trigger backstop to an invalid-container result', async () => {
    const triggerError = new Error('insert failed', {
      cause: new Error(
        'container item does not belong to this list: SQLITE_CONSTRAINT_TRIGGER',
      ),
    })
    const select = vi
      .fn()
      // ownsList
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 'list-1' }] }),
        }),
      })
      // the container item's gear name
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => [{ name: 'Pack' }] }),
          }),
        }),
      })
      // ownedListQuery, built for the batch below and never awaited on its own
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({ where: () => ({ orderBy: () => ({}) }) }),
          }),
        }),
      })
    // The insert is now a STATEMENT handed to db.batch rather than an awaited
    // promise, so the trigger abort surfaces from the batch. Mapping it is
    // still what this test is about.
    const insert = vi.fn(() => ({ values: () => ({ returning: () => ({}) }) }))
    const batch = vi.fn(async () => { throw triggerError })
    const db = { select, insert, batch } as unknown as Db

    await expect(
      createPackingLocationsRepo(db, 'user-1').create('list-1', {
        containerListItemId: 'item-1',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_container_item' })
  })

  // What these two pin is that the write and its read-back travel in ONE
  // db.batch. That is the whole fix: a batch is a real D1 transaction, so a
  // read-back that throws takes the write down with it. Written as a
  // write-then-read pair instead, a failed read reports failure over a row
  // that has already committed - you retry and are told the name is taken.
  //
  // D1 does the rolling back; what this code controls is that both statements
  // are in the same batch, so that is what is asserted. Split them again and
  // batch is called with one statement (or not at all) and these fail.
  it('creates a location and reads it back in one batch', async () => {
    const readBack = { readBack: true }
    const select = vi
      .fn()
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 'list-1' }] }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({ where: () => ({ orderBy: () => readBack }) }),
          }),
        }),
      })
    const insertStatement = { insert: true }
    const insert = vi.fn(() => ({
      values: () => ({ returning: () => insertStatement }),
    }))
    const batch = vi.fn(async () => [
      [{ id: 'loc-1' }],
      [{ id: 'loc-1', name: 'Dry bag', sortOrder: 0, containerListItemId: null }],
    ])
    const db = { select, insert, batch } as unknown as Db

    await expect(
      createPackingLocationsRepo(db, 'user-1').create('list-1', {
        name: 'Dry bag',
      }),
    ).resolves.toEqual({
      ok: true,
      row: { id: 'loc-1', name: 'Dry bag', sortOrder: 0, containerListItemId: null },
    })
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch).toHaveBeenCalledWith([insertStatement, readBack])
  })

  it('renames a location and reads it back in one batch', async () => {
    const readBack = { readBack: true }
    const select = vi
      .fn()
      // the pre-read that rejects an unknown or item-backed location
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({
            limit: async () => [{ containerListItemId: null }],
          }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({ where: () => ({ orderBy: () => readBack }) }),
          }),
        }),
      })
    const updateStatement = { update: true }
    const update = vi.fn(() => ({
      set: () => ({ where: () => ({ returning: () => updateStatement }) }),
    }))
    const batch = vi.fn(async () => [
      [{ id: 'loc-1' }],
      [{ id: 'loc-1', name: 'Food bag', sortOrder: 0, containerListItemId: null }],
    ])
    const db = { select, update, batch } as unknown as Db

    await expect(
      createPackingLocationsRepo(db, 'user-1').rename('list-1', 'loc-1', 'Food bag'),
    ).resolves.toEqual({
      ok: true,
      row: { id: 'loc-1', name: 'Food bag', sortOrder: 0, containerListItemId: null },
    })
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch).toHaveBeenCalledWith([updateStatement, readBack])
  })
})
