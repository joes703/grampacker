import { describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { importErrorMessage } from './import-error'

const UNSURE = "Couldn't confirm the import. Check your lists before trying again."

describe('importErrorMessage', () => {
  // The import may have gone through, and retrying would make a duplicate.
  it.each([
    ['a server failure', new ApiError(500, 'Internal Server Error')],
    ['a dropped connection', new TypeError('Failed to fetch')],
    ['something that is not an Error', 'nope'],
  ])('asks the user to check first after %s', (_label, err) => {
    expect(importErrorMessage(err, 'lists')).toBe(UNSURE)
  })

  it('names the place to check', () => {
    expect(importErrorMessage(new ApiError(503, 'x'), 'inventory')).toBe(
      "Couldn't confirm the import. Check your inventory before trying again.",
    )
  })

  // Nothing was imported, and these say what to fix.
  it.each([
    ['a server refusal', new ApiError(422, 'Too many items')],
    ['a cap check before the request', new Error('This import would go over the limit.')],
  ])('keeps the message after %s', (_label, err) => {
    expect(importErrorMessage(err, 'lists')).toBe(err.message)
  })
})
