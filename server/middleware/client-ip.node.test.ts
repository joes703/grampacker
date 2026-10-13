import { describe, it, expect } from 'vitest'
import { clientIpFromForwardedFor, rateLimitIpKey } from './client-ip'

describe('rateLimitIpKey', () => {
  it('keys IPv4 by the exact address', () => {
    expect(rateLimitIpKey('203.0.113.7')).toBe('203.0.113.7')
    expect(rateLimitIpKey('203.0.113.8')).not.toBe(rateLimitIpKey('203.0.113.7'))
  })

  it('collapses an IPv6 /64 into one bucket', () => {
    // The whole point: an attacker rotating addresses inside their own
    // /64 must not mint fresh rate-limit budget.
    const a = rateLimitIpKey('2001:db8:1:2::5')
    const b = rateLimitIpKey('2001:db8:1:2:ffff:ffff:ffff:ffff')
    const c = rateLimitIpKey('2001:0db8:0001:0002:dead:beef:0000:0001')
    expect(a).toBe('2001:db8:1:2::/64')
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('keeps different /64s in different buckets', () => {
    expect(rateLimitIpKey('2001:db8:1:3::5')).not.toBe(rateLimitIpKey('2001:db8:1:2::5'))
  })

  it('normalizes case and :: expansion to the same key', () => {
    expect(rateLimitIpKey('2001:DB8:1:2::5')).toBe('2001:db8:1:2::/64')
    expect(rateLimitIpKey('2001:db8:1:2:0:0:0:5')).toBe('2001:db8:1:2::/64')
  })

  it('unwraps IPv4-mapped IPv6 to the IPv4 address', () => {
    // The trap: naive expansion makes every IPv4-mapped client share the
    // bucket 0:0:0:0::/64, so one limited client locks out all of IPv4.
    expect(rateLimitIpKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(rateLimitIpKey('::ffff:203.0.113.8')).toBe('203.0.113.8')
    expect(rateLimitIpKey('::FFFF:203.0.113.7')).toBe('203.0.113.7')
    // Same client, either spelling, one bucket.
    expect(rateLimitIpKey('::ffff:203.0.113.7')).toBe(rateLimitIpKey('203.0.113.7'))
    // And crucially: two distinct IPv4 clients stay distinct.
    expect(rateLimitIpKey('::ffff:203.0.113.7')).not.toBe(
      rateLimitIpKey('::ffff:203.0.113.8'),
    )
  })

  it('strips a zone id rather than letting it fragment buckets', () => {
    expect(rateLimitIpKey('fe80::1%eth0')).toBe(rateLimitIpKey('fe80::1'))
  })

  it('canonicalizes IPv4 so one host cannot hold two buckets', () => {
    // Echoing the raw text would give '001.002.003.004' its own budget,
    // separate from '1.2.3.4' - the same host, twice the allowance.
    expect(rateLimitIpKey('001.002.003.004')).toBe('1.2.3.4')
    expect(rateLimitIpKey('001.002.003.004')).toBe(rateLimitIpKey('1.2.3.4'))
  })

  it('does not merge distinct garbage inputs that happen to contain %', () => {
    // Stripping '%...' unconditionally would collapse both of these to 'bad'.
    // Unknown input must never merge distinct clients into a shared bucket.
    expect(rateLimitIpKey('bad%a')).not.toBe(rateLimitIpKey('bad%b'))
  })

  it('keys unparseable input by its own raw text, never a shared bucket', () => {
    // Fail closed: garbage must not merge distinct clients.
    expect(rateLimitIpKey('not-an-ip')).toBe('not-an-ip')
    expect(rateLimitIpKey('1.2.3.999')).toBe('1.2.3.999')
    expect(rateLimitIpKey('2001:db8::1::2')).toBe('2001:db8::1::2')
    expect(rateLimitIpKey('not-an-ip')).not.toBe(rateLimitIpKey('other-garbage'))
  })

  it('maps empty input to a single explicit bucket', () => {
    expect(rateLimitIpKey('')).toBe('unknown')
    expect(rateLimitIpKey('   ')).toBe('unknown')
  })
})

describe('clientIpFromForwardedFor', () => {
  it('takes the rightmost entry, the one Caddy writes', () => {
    expect(clientIpFromForwardedFor('203.0.113.7')).toBe('203.0.113.7')
    expect(clientIpFromForwardedFor('192.0.2.1, 198.51.100.2,203.0.113.7')).toBe('203.0.113.7')
    expect(clientIpFromForwardedFor(' 2001:db8::1 ')).toBe('2001:db8::1')
  })

  it('is undefined when there is no usable entry', () => {
    expect(clientIpFromForwardedFor(undefined)).toBeUndefined()
    expect(clientIpFromForwardedFor('')).toBeUndefined()
    expect(clientIpFromForwardedFor('192.0.2.1, ')).toBeUndefined()
  })
})
