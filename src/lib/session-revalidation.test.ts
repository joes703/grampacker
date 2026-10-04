// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// This file drives the REAL better-auth client on purpose. A test that mocked
// authClient would only prove that this module calls a function we invented, and the
// thing most likely to break here is the opposite: that the private atom access in
// session-revalidation.ts stops reaching better-auth's actual session refetch after a
// package bump. So the assertions below go all the way through to the atom.
//
// TWO ORDERING TRAPS, both load-bearing:
//
//  1. better-auth captures the global fetch when the CLIENT IS CONSTRUCTED
//     (`customFetchImpl: fetch` in better-auth/dist/client/config.mjs), and that
//     happens at module scope in src/lib/auth-client.ts. A static import here plus a
//     vi.stubGlobal in beforeEach would install the stub on a function nobody ever
//     calls. Hence stub first, then dynamically import.
//  2. vi.resetModules() per test is what isolates the module-level `inFlight` and
//     `trailing` state AND gives each test a fresh session atom (which starts at
//     data: null). That is why the module needs no test-only reset hook.

type Payload = { session: unknown; user: unknown } | null

function jsonResponse(payload: Payload): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const A_SESSION: Payload = {
  session: { id: 'sess-1', userId: 'user-1', expiresAt: '2099-01-01T00:00:00.000Z' },
  user: { id: 'user-1', email: 'joe@example.com', name: 'Joe', emailVerified: true },
}

type Harness = {
  fetchMock: ReturnType<typeof vi.fn>
  revalidateSessionAfterUnauthorized: () => void
  settled: () => Promise<void>
  sessionData: () => unknown
  session: () => { refetch: () => Promise<void> }
  requestedPaths: () => string[]
  timeoutMs: number
}

// Every harness mounts a fresh better-auth client, and a mounted session atom holds
// window focus/online/broadcast listeners. vi.resetModules() gives the next test fresh
// MODULES, not a cleaned-up previous atom - so without this, each test would leave
// another live client listening, and a focus or storage event in a later test would
// wake all of them against their own stale fetch mocks.
const teardowns: Array<() => void> = []

async function harness(): Promise<Harness> {
  // mockImplementation, not mockResolvedValue: a Response body can be read once, and
  // mockResolvedValue would hand the SAME consumed object to every later call.
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(null)))
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()

  const mod = await import('./session-revalidation')
  const { authClient } = await import('./auth-client')
  const atom = authClient.$store.atoms.session
  // Not decoration: if better-auth ever renames this atom, the module under test
  // throws and silently stops re-checking sessions. Failing here says so out loud.
  if (!atom) throw new Error('better-auth exposes no session atom')
  const read = () => atom.get() as ReturnType<typeof authClient.useSession>

  // Subscribe before measuring anything. Nano Stores atoms are lazy: the first
  // subscriber (or even the first get()) MOUNTS the atom, and better-auth's mount
  // schedules an initial /get-session of its own. In production SessionCacheGuard has
  // been subscribed at the root of the document since first paint, so that mount fetch
  // is long past by the time any 401 happens. Doing it here too - and clearing the
  // counter afterwards - is what makes the request counts below mean what they say.
  teardowns.push(atom.subscribe(() => {}))
  await vi.waitFor(() => {
    expect(fetchMock).toHaveBeenCalled()
    expect(read().isRefetching).toBe(false)
  })
  fetchMock.mockClear()

  return {
    fetchMock,
    revalidateSessionAfterUnauthorized: mod.revalidateSessionAfterUnauthorized,
    settled: mod.sessionRevalidationSettled,
    sessionData: () => read().data,
    session: read,
    requestedPaths: () =>
      fetchMock.mock.calls.map((call) => new URL(String(call[0])).pathname),
    timeoutMs: mod.SESSION_CHECK_TIMEOUT_MS,
  }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  // Unsubscribing is not enough on its own. Nano Stores DEFERS an atom's real cleanup
  // by a second after its last listener goes, so on real timers that cleanup lands in
  // the middle of the next test, and under the fake timers one test installs,
  // vi.useRealTimers() would throw the scheduled callback away entirely - leaving that
  // client subscribed to better-auth's global focus/online/broadcast managers with its
  // own stale fetch mock still captured. Doing the whole teardown on a fake clock and
  // advancing past the delay is what actually unmounts it.
  if (!vi.isFakeTimers()) vi.useFakeTimers()
  while (teardowns.length) teardowns.pop()?.()
  vi.advanceTimersByTime(1_100)
  vi.useRealTimers()
})

describe('the bridge to better-auth', () => {
  it('actually asks the server who this browser is', async () => {
    const h = await harness()
    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.requestedPaths()).toEqual(['/api/auth/get-session'])
  })

  it('publishes the answer onto the session atom: established -> gone', async () => {
    // The atom STARTS at data: null, so "a null response leaves data null" would pass
    // even if refetch() stopped applying its response entirely - which is exactly the
    // regression this test exists to catch. So: establish a real session first, and
    // assert the TRANSITION. Without it, SessionCacheGuard never sees the
    // established -> null change it tears the document down on, and a revoked session
    // keeps the signed-in screens up while every request fails.
    const h = await harness()

    h.fetchMock.mockResolvedValueOnce(jsonResponse(A_SESSION))
    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.sessionData()).not.toBeNull()

    h.fetchMock.mockResolvedValueOnce(jsonResponse(null))
    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.sessionData()).toBeNull()
  })

  it('keeps the existing session when the check fails for a reason other than a 401', async () => {
    // better-auth's policy, restated here as a test because this module's residual
    // risk depends on it: a transient failure must not be read as "signed out", or an
    // outage would tear down live sessions. Recovery is the next 401, or better-auth's
    // own focus/online refetch.
    const h = await harness()

    h.fetchMock.mockResolvedValueOnce(jsonResponse(A_SESSION))
    h.revalidateSessionAfterUnauthorized()
    await h.settled()

    h.fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))
    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.sessionData()).not.toBeNull()
  })
})

describe('coalescing', () => {
  // The guarantee is deliberately narrow: at most one leading check and one trailing
  // check for the calls that OVERLAP a single in-flight window. Calls that arrive
  // after a check settles get their own, which is the point - a 401 is only covered
  // by an answer obtained after it.

  it('a burst arriving during one check costs two requests, not one and not five', async () => {
    const h = await harness()
    // The deferred is built BEFORE the call rather than inside the mock, because
    // @better-fetch/fetch does async work before it reaches customFetchImpl - there is
    // no synchronous moment at which a handle assigned inside the mock exists yet.
    let release: ((res: Response) => void) | undefined
    h.fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        release = resolve
      }),
    )

    h.revalidateSessionAfterUnauthorized()
    // Four more 401s land while the first check is still out. The dedupe latches
    // synchronously (run() assigns inFlight before its first await), so it does not
    // matter that the request itself has not been issued yet.
    h.revalidateSessionAfterUnauthorized()
    h.revalidateSessionAfterUnauthorized()
    h.revalidateSessionAfterUnauthorized()
    h.revalidateSessionAfterUnauthorized()

    await vi.waitFor(() => expect(h.fetchMock).toHaveBeenCalledTimes(1))
    // Still one: the trailing check must not start until the leading one settles.
    await Promise.resolve()
    await Promise.resolve()
    expect(h.fetchMock).toHaveBeenCalledTimes(1)

    release?.(jsonResponse(null))
    await h.settled()
    // One leading + one trailing. Not one: the leading check may predate the
    // revocation, so the burst is owed an answer of its own. Not five: they all ask
    // the same question.
    expect(h.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a 401 after everything has settled gets a check of its own', async () => {
    const h = await harness()

    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.fetchMock).toHaveBeenCalledTimes(1)

    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a check that never comes back does not wedge the module either', async () => {
    // The reason for the bounded wait: `fetch` has no default timeout, so a response
    // whose body never finishes would pin the coalescer forever. Every later 401 would
    // set `trailing` and nothing would ever start the run that consumes it, so a
    // revoked session would never be noticed. The earlier deferred tests cannot catch
    // this: they all release the first check.
    const h = await harness()
    // Fake timers BEFORE the check starts: the bound is scheduled inside run(), so
    // installing them afterwards would leave a real timer that no advance can move.
    vi.useFakeTimers()
    h.fetchMock.mockReturnValueOnce(new Promise<Response>(() => {}))

    h.revalidateSessionAfterUnauthorized()
    await vi.advanceTimersByTimeAsync(0) // flush microtasks; the request goes out
    expect(h.fetchMock).toHaveBeenCalledTimes(1)

    // A second 401 arrives while the first check is still hanging.
    h.revalidateSessionAfterUnauthorized()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(h.timeoutMs + 1)
    expect(h.fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a failed check does not wedge the module against later 401s', async () => {
    // A rejected fetch is not enough to test this: better-auth settles a failed
    // /get-session onto the atom and resolves refetch() anyway. So the refetch
    // itself rejects here, once. If run() let that rejection escape, `inFlight`
    // would never clear and no later 401 would ask again.
    const h = await harness()
    vi.spyOn(h.session(), 'refetch').mockRejectedValueOnce(new Error('refetch failed'))

    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.fetchMock).not.toHaveBeenCalled()

    h.revalidateSessionAfterUnauthorized()
    await h.settled()
    expect(h.requestedPaths()).toEqual(['/api/auth/get-session'])
  })
})
