import { describe, expect, it } from 'vitest'
import { parseUses } from './check-action-pins.mjs'

// The checker guards the pin-by-SHA rule, so its own parser must not skip
// lines. YAML allows the `uses:` value to be quoted; a parser that only
// matches the bare form silently waves a quoted tag pin through the check.

const SHA = 'a'.repeat(40)

describe('parseUses', () => {
  it('parses the bare form, with and without the list dash and trailer', () => {
    expect(parseUses(`      - uses: actions/checkout@${SHA} # v4.2.2`)).toEqual({
      action: 'actions/checkout',
      ref: SHA,
      trailer: '# v4.2.2',
    })
    expect(parseUses('        uses: actions/setup-node@v4')).toEqual({
      action: 'actions/setup-node',
      ref: 'v4',
      trailer: '',
    })
  })

  it('parses a double-quoted value, so a quoted tag pin is reported', () => {
    expect(parseUses('      - uses: "actions/checkout@v4"')).toEqual({
      action: 'actions/checkout',
      ref: 'v4',
      trailer: '',
    })
  })

  it('parses a single-quoted value, including its trailer', () => {
    expect(parseUses(`      - uses: 'actions/checkout@${SHA}' # v4.2.2`)).toEqual({
      action: 'actions/checkout',
      ref: SHA,
      trailer: '# v4.2.2',
    })
  })

  it('still skips local actions, docker refs, and non-uses lines', () => {
    expect(parseUses('      - uses: ./.github/actions/build@main')).toBeNull()
    expect(parseUses('      - uses: docker://alpine@sha256:abc')).toBeNull()
    expect(parseUses('      - run: echo "uses: actions/checkout@v4"')).toBeNull()
  })
})
