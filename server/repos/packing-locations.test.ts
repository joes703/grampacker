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
      .mockReturnValueOnce({
        from: () => ({
          where: () => ({ limit: async () => [{ id: 'list-1' }] }),
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => [{ name: 'Pack' }] }),
          }),
        }),
      })
    const insert = vi.fn(() => ({
      values: () => ({ returning: async () => { throw triggerError } }),
    }))
    const db = { select, insert } as unknown as Db

    await expect(
      createPackingLocationsRepo(db, 'user-1').create('list-1', {
        containerListItemId: 'item-1',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid_container_item' })
  })
})
