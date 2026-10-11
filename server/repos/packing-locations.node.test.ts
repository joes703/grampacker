import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '../db'
import { createPackingLocationsRepo } from './packing-locations'

const runBatch = vi.hoisted(() => vi.fn())
vi.mock('../db', () => ({ runBatch }))

describe('createPackingLocationsRepo', () => {
  beforeEach(() => runBatch.mockReset())

  // What these two pin is that the write and its read-back travel in ONE
  // db.batch. That is the whole fix: a batch is a real D1 transaction, so a
  // read-back that throws takes the write down with it. Written as a
  // write-then-read pair instead, a failed read reports failure over a row
  // that has already committed - and since location names are NOT unique,
  // retrying then makes a second bag with the same name rather than refusing.
  //
  // These are STRUCTURAL and that is all they are. They prove the two
  // statements go in one batch, which is the part this code controls and the
  // regression worth catching; both were mutation-tested by splitting the
  // batch. They do NOT prove D1's transaction semantics, read-your-writes, or
  // the error shape - the mock invents its own results, and these sentinels
  // are not thenable, so they would also pass an implementation that awaited
  // the write builder before batching it. The real-workerd route tests in
  // server/routes/packing-locations.test.ts carry that weight.
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
    runBatch.mockResolvedValueOnce([
      [{ id: 'loc-1' }],
      [{ id: 'loc-1', name: 'Dry bag', sortOrder: 0, containerListItemId: null }],
    ])
    const db = { select, insert } as unknown as Db

    await expect(
      createPackingLocationsRepo(db, 'user-1').create('list-1', {
        name: 'Dry bag',
      }),
    ).resolves.toEqual({
      ok: true,
      row: { id: 'loc-1', name: 'Dry bag', sortOrder: 0, containerListItemId: null },
    })
    expect(runBatch).toHaveBeenCalledTimes(1)
    expect(runBatch).toHaveBeenCalledWith(db, [insertStatement, readBack])
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
    runBatch.mockResolvedValueOnce([
      [{ id: 'loc-1' }],
      [{ id: 'loc-1', name: 'Food bag', sortOrder: 0, containerListItemId: null }],
    ])
    const db = { select, update } as unknown as Db

    await expect(
      createPackingLocationsRepo(db, 'user-1').rename('list-1', 'loc-1', 'Food bag'),
    ).resolves.toEqual({
      ok: true,
      row: { id: 'loc-1', name: 'Food bag', sortOrder: 0, containerListItemId: null },
    })
    expect(runBatch).toHaveBeenCalledTimes(1)
    expect(runBatch).toHaveBeenCalledWith(db, [updateStatement, readBack])
  })
})
