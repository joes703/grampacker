import { z } from 'zod'

// A fractional number with a bounded number of decimal places. The refine
// rejects any value that is not exactly representable at `decimals` places, so
// the DB's precision can't be exceeded from the client.
//
// The check is `round(v*scale)/scale === v`, NOT the epsilon form
// `abs(v*scale - round(v*scale)) < 1e-6`. The epsilon form is magnitude-
// fragile: near the upper bound, v*scale loses so much precision that an
// 8-decimal value can land exactly on an integer and pass as "2 decimals"
// (99999999.00999999 * 100 === 9999999901). Comparing the
// round-tripped value back to the original catches that.
//
// Lives in its own leaf module so schema modules can
// use it without importing each other.
export function decimalNumber(opts: {
  min: number
  max: number
  decimals: number
}) {
  const scale = 10 ** opts.decimals
  return z.number().min(opts.min).max(opts.max).refine((v) => Math.round(v * scale) / scale === v, {
    message: `at most ${opts.decimals} decimal places`,
  })
}
