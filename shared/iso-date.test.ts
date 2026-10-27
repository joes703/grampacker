import { describe, expect, it } from 'vitest'
import { createGearItemRequestSchema } from './gear'

// A purchase date must be a real calendar date written YYYY-MM-DD.
const purchaseDate = createGearItemRequestSchema.shape.purchaseDate

describe('purchase date', () => {
  it.each(['2024-02-29', '2026-12-31', '0001-01-01', '9999-12-31', '2000-02-29'])(
    'accepts %s',
    (date) => {
      expect(purchaseDate.safeParse(date).success).toBe(true)
    },
  )

  it.each(['2026-02-29', '1900-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-4-1', '26-04-01', '2026-04-01T00:00:00Z', ''])(
    'refuses %j',
    (date) => {
      expect(purchaseDate.safeParse(date).success).toBe(false)
    },
  )
})
