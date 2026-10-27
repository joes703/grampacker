import { describe, expect, it } from 'vitest'
import { emailBucketKey } from './rate-limit'

// Known outputs, so a change to the HMAC (encoding, domain prefix,
// lowercasing, truncation) cannot pass unnoticed. A changed key would also
// reset every address's send budget on deploy.
describe('emailBucketKey', () => {
  const secret = 'test-only-secret-at-least-32-chars-long!'

  it.each([
    ['Hiker@Example.com', '05778eff7e2c0067bbd78e7e946c2ede'],
    // Lowercased, not trimmed.
    [' spaced@example.com ', 'fb520fb0521143ae5fa66ce9ce488fb3'],
    // UTF-8.
    ['ünïcode@example.com', '27ac1a4c32a279c30ac65b671c3bcfea'],
  ])('%j -> %s', async (email, expected) => {
    expect(await emailBucketKey(secret, email)).toBe(expected)
  })
})
