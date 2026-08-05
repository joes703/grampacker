import { authClient } from './auth-client'

// What a 401 from an app-owned route means, decided in one place.
//
// The answer is deliberately NOT "sign the user out". It is "ask the server who
// this browser is". Everything after that already exists and is already tested:
// better-auth's session atom publishes `data: null` when /get-session says the
// session is gone, SessionCacheGuard (src/layout/session-cache-guard.tsx) turns an
// established-user -> null transition into a synchronous suppression plus a
// full-document teardown, and RequireSession sends null on to /sign-in. This module
// is only the missing trigger: without it nothing ever asks, so a session revoked or
// expired mid-use leaves the authenticated chrome up while every query fails and
// every mutation rolls back (finding P1.5).
//
// SCOPE. This is an app-owned-routes policy, not a global one. `rawFetch` never sees
// /api/auth/* - better-auth's own client owns that traffic - and inside the routes it
// DOES see, the only 401 is server/middleware/session.ts's `requireSession`, which
// means exactly one thing: no session. That is what makes "401 implies the session is
// gone" a sound inference here. It would not be sound if this ran over every route:
// the passkey freshness gate (hooks.before in server/auth.ts) answers 403 for
// "signed in, but not recently enough", and reading that as a dead session would
// sign someone out for declining to confirm a passkey change. (Its 401 does mean
// no session, same as requireSession - but it, too, is inside /api/auth/* and
// never reaches here.)
//
// It cannot loop. The session check goes out through better-auth's private $fetch,
// never through `rawFetch`, so its own 401 cannot re-enter this module.

// The value better-auth's session atom holds. `$store.atoms` is typed
// `Record<string, WritableAtom<any>>` upstream (better-auth/dist/client/config.d.mts),
// so the atom carries no shape of its own - but useSession() types that SAME value
// precisely (better-auth/dist/client/react/index.d.mts). Deriving from the hook rather
// than hand-copying the signature is what makes an upstream change that moves or drops
// `refetch` a BUILD error here instead of a silent no-op in production.
type SessionSnapshot = ReturnType<typeof authClient.useSession>

// Why this and not `$store.notify('$sessionSignal')`, which is the more obvious API:
// notify flips a boolean that only a MOUNTED atom's refresh manager is listening to,
// and it hands back nothing to wait on. `refetch` is the atom's own closure - it runs
// with or without subscribers, and it returns a promise, which is the whole reason the
// coalescing below can be exact instead of a timer approximating one.
function refetchSession(): Promise<void> {
  // `atoms` is a string-keyed record upstream, so under noUncheckedIndexedAccess this
  // lookup is genuinely optional. Throwing rather than asserting is deliberate: it is
  // the one runtime signal that the private shape this module depends on has moved,
  // and run() below turns it into "no check happened" instead of a broken document.
  const atom = authClient.$store.atoms.session
  if (!atom) throw new Error('better-auth exposes no session atom')
  return (atom.get() as SessionSnapshot).refetch()
}

// How long a session check may hold the coalescer before it stops being waited on.
//
// Not a policy knob and not a debounce - a liveness bound. `fetch` has no default
// timeout and better-auth passes an AbortSignal with no deadline on it, so a response
// whose body never finishes would otherwise pin `inFlight` forever: every later 401
// would set `trailing` and nothing would ever start the run that consumes it. That is
// P1.5 rebuilt inside the fix, which is exactly the trap the first design fell into.
//
// When this fires we stop AWAITING the stuck check; we do not cancel it here. The
// trailing run's own refetch aborts it (better-auth aborts the previous controller on
// every fetchSession), so the stuck request is cleaned up by the thing that replaces
// it.
//
// 10s is a threshold, not proof of death: a real check on a bad connection can exceed
// it, and if another 401 is owed its replacement will abort the slow one. That is the
// right trade here because nothing in this app generates 401s on its own - queries do
// not retry them (shouldRetryQuery) and there is no polling - so restarts are paced by
// user action rather than by a loop, and being slow to answer is a worse state to sit
// in than being asked twice.
export const SESSION_CHECK_TIMEOUT_MS = 10_000

// One check may be in flight; one more may be owed. Nothing else is remembered,
// because nothing else matters: a hundred 401s arriving during a check ask the same
// question, and one answer obtained after the last of them answers all of them.
let inFlight: Promise<void> | null = null
let trailing = false

// Logged at most once per document. A missing atom means this module has silently
// stopped re-checking sessions for good, which is worth exactly one loud line and no
// more - a per-401 message would bury it under the failures it is explaining.
let structuralFailureReported = false

export function revalidateSessionAfterUnauthorized(): void {
  // Coalesce rather than drop. The distinction is the whole design: a check already
  // running may have been started BEFORE the revocation, or may fail with a non-401
  // (better-auth deliberately keeps the existing session on any error that is not a
  // 401, so a transient 500 leaves the stale session in place). Either way its answer
  // cannot be trusted to cover this 401, so this 401 earns another check.
  if (inFlight) {
    trailing = true
    return
  }
  void run()
}

function expireAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Never rejects, by construction - both failure paths are handled - so the fire-and-
// forget `void run()` calls above and below cannot become unhandled rejections.
async function run(): Promise<void> {
  trailing = false
  let pending: Promise<void>
  try {
    pending = refetchSession()
  } catch (error) {
    // Only reachable if the atom shape asserted above stops holding at runtime. Note
    // the split: losing `refetch` from the typed hook shape is a BUILD error, but a
    // renamed or removed atom key is not - session-revalidation.test.ts is what
    // catches that one, by driving the real client. Give up on this
    // check rather than take the document down with an unhandled rejection - but say
    // so, because the silent version of this is an app that never signs anyone out
    // again and gives no clue why.
    if (!structuralFailureReported) {
      structuralFailureReported = true
      console.error('[session-revalidation] cannot reach better-auth; 401s will not re-check the session', error)
    }
    return
  }
  // The coalescer waits on THIS rather than on the check itself: bounded (see
  // SESSION_CHECK_TIMEOUT_MS) and non-rejecting. Racing also keeps a late rejection of
  // `pending` handled, so it cannot surface as an unhandled rejection after we have
  // stopped caring about it.
  const bounded = Promise.race([pending, expireAfter(SESSION_CHECK_TIMEOUT_MS)]).catch(
    () => {
      // better-auth settles failures onto the atom itself; there is nothing for us to
      // add. Deliberately no retry ladder of our own: it would duplicate better-auth's
      // focus/online/broadcast refetches, and a private retry during an outage is how
      // you tear a live session down for no reason.
    },
  )
  inFlight = bounded
  await bounded
  inFlight = null
  if (trailing) void run()
}

// Test-only. Resolves once no check is running AND none is owed - including the
// trailing one, which starts synchronously in run()'s continuation and so is already
// visible here by the time this loop re-reads `inFlight`.
export async function sessionRevalidationSettled(): Promise<void> {
  while (inFlight) await inFlight
}
