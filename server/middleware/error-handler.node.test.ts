import { DrizzleQueryError } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeError, recordAuthLog, resetLogBudget } from './error-handler'

// The shape every log entry is built from. Pure: no binding, no app, so it
// runs on Node (docs/testing-and-ci.md section 3). The workerd half - a REAL
// Drizzle failure against D1, and better-auth's own logger calls - lives in
// error-handler.test.ts and server/auth-error-logging.test.ts.

const SENTINEL = 'bound-value-that-must-never-be-logged-4c1e'

function drizzleFailure(params: unknown[], cause: unknown = new Error('D1_ERROR: no such table: nope: SQLITE_ERROR')) {
  return new DrizzleQueryError('select 1 from nope where x = ?', params, cause as Error)
}

describe('describeError', () => {
  it('replaces a parameter-bearing message and keeps the query and the root cause', () => {
    const entry = describeError(drizzleFailure([SENTINEL]))
    expect(JSON.stringify(entry)).not.toContain(SENTINEL)
    expect(entry.message).toContain('select 1 from nope where x = ?')
    expect(entry.message).toContain('redacted')
    expect(entry.cause).toEqual([
      { name: 'Error', message: 'D1_ERROR: no such table: nope: SQLITE_ERROR' },
    ])
  })

  it('logs no stack for a parameter-bearing error', () => {
    // V8 repeats the message as the stack header, so the stack is a second
    // copy of every bound value. Rather than trust a filter, drop it.
    const entry = describeError(drizzleFailure([SENTINEL]))
    expect(entry.stack).toBeUndefined()
  })

  it('is not fooled by a bound value that looks like a stack frame', () => {
    const fakeFrame = `\n    at ${SENTINEL} (fake.ts:1:1)`
    const entry = describeError(drizzleFailure([fakeFrame]))
    expect(JSON.stringify(entry)).not.toContain(SENTINEL)
  })

  it('redacts a parameter-bearing error found down the cause chain', () => {
    const wrapped = new Error('outer', { cause: drizzleFailure([SENTINEL]) })
    const entry = describeError(wrapped)
    expect(JSON.stringify(entry)).not.toContain(SENTINEL)
    expect(entry.cause?.[0]?.message).toContain('redacted')
    expect(entry.cause?.[1]?.message).toContain('no such table')
  })

  it('cuts an already-stringified Drizzle message at the first params marker', () => {
    // better-auth re-logs `err.message` on its own in places, so the string
    // form has to be safe too - including when a bound value carries the
    // marker itself (the cut is at the FIRST one, dropping more, never less).
    const message = `Failed query: select ?\nparams: ${SENTINEL}\nparams: second`
    const entry = describeError(new Error(message))
    expect(JSON.stringify(entry)).not.toContain(SENTINEL)
    expect(entry.message).toBe('Failed query: select ? (bound params redacted)')
  })

  it('keeps the frames of an ordinary error and drops only the header', () => {
    const entry = describeError(new Error('kaboom'))
    expect(entry.message).toBe('kaboom')
    expect(entry.stack).toMatch(/^\s+at /)
    expect(entry.stack).not.toContain('kaboom')
  })

  it('logs no stack when the layout is not the V8 one', () => {
    const err = new Error('kaboom')
    err.stack = 'something unrecognized'
    expect(describeError(err).stack).toBeUndefined()
    err.stack = undefined
    expect(describeError(err).stack).toBeUndefined()
  })

  it('terminates on a cyclic cause chain and bounds a deep one', () => {
    const a = new Error('a')
    const b = new Error('b', { cause: a })
    a.cause = b
    expect(describeError(a).cause).toEqual([{ name: 'Error', message: 'b' }])

    let deep: Error = new Error('leaf')
    for (let i = 0; i < 20; i += 1) deep = new Error(`link ${i}`, { cause: deep })
    expect(describeError(deep).cause).toHaveLength(5)
  })

  it('never coerces a non-string message or an oversized name into the entry', () => {
    // String(message) would run an object's own toString / toStringTag; a
    // hand-built stack whose first line carries more than the header would
    // keep that suffix under a plain prefix match.
    const tagged = { name: 'Error', message: { [Symbol.toStringTag]: SENTINEL } }
    expect(JSON.stringify(describeError(tagged))).not.toContain(SENTINEL)
    const bigName = new Error('x')
    bigName.name = 'N'.repeat(10_000)
    expect(describeError(bigName).name.length).toBeLessThan(200)
    const padded = new Error('safe')
    padded.stack = `Error: safe [session=${SENTINEL}]\n    at caller (x.ts:1:1)`
    expect(JSON.stringify(describeError(padded))).not.toContain(SENTINEL)
  })

  it('describes a non-object throw without pretending it is an Error', () => {
    expect(describeError('just a string')).toEqual({ name: 'string', message: 'just a string' })
    expect(describeError(undefined)).toEqual({ name: 'undefined', message: 'undefined' })
  })

  it('bounds message and query text', () => {
    const long = 'x'.repeat(10_000)
    expect(describeError(new Error(long)).message.length).toBeLessThan(2100)
    expect(
      describeError(new DrizzleQueryError(long, [], new Error('root'))).message.length,
    ).toBeLessThan(2200)
  })
})

describe('recordAuthLog', () => {
  let consoleError: ReturnType<typeof vi.spyOn>
  let consoleWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetLogBudget()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })

  const everything = () =>
    [...consoleError.mock.calls, ...consoleWarn.mock.calls].flat().map(String).join('\n')

  it('sanitizes an Error in the message position as well as the details', () => {
    // better-auth's list-sessions calls logger.error(e) with the error FIRST,
    // and createLogger forwards it unchanged despite the string signature.
    recordAuthLog('error', drizzleFailure([SENTINEL]))
    recordAuthLog('error', 'INTERNAL_SERVER_ERROR', drizzleFailure([SENTINEL]))
    const out = everything()
    expect(out).not.toContain(SENTINEL)
    expect(out).toContain('no such table')
    expect(consoleError).toHaveBeenCalledTimes(2)
    for (const [line] of consoleError.mock.calls) {
      expect(JSON.parse(String(line))).toMatchObject({ event: 'auth-log', level: 'error' })
    }
  })

  it('routes warnings to console.warn with the same shape', () => {
    recordAuthLog('warn', 'something odd', { detail: 1 })
    expect(consoleWarn).toHaveBeenCalledTimes(1)
    expect(consoleError).not.toHaveBeenCalled()
    expect(JSON.parse(String(consoleWarn.mock.calls[0]?.[0]))).toMatchObject({
      event: 'auth-log',
      level: 'warn',
      message: 'something odd',
    })
  })

  it('shares the per-isolate ceiling with the incident handler', () => {
    for (let i = 0; i < 100; i += 1) recordAuthLog('error', `flood ${i}`)
    for (let i = 0; i < 100; i += 1) recordAuthLog('warn', `flood ${i}`)
    const lines = [...consoleError.mock.calls, ...consoleWarn.mock.calls].map(
      ([line]) => JSON.parse(String(line)) as { event: string },
    )
    expect(lines).toHaveLength(21)
    expect(lines.filter((l) => l.event === 'auth-log')).toHaveLength(20)
    expect(lines.filter((l) => l.event === 'server-error-suppressed')).toHaveLength(1)
  })
})
