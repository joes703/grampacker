import type { Mutation } from '@tanstack/react-query'
import { ApiError } from './api'
import { showToast } from './toast'

// Opt-in per-mutation failure feedback. A non-optimistic mutation (no visible
// snap-back to act as the error signal) sets `meta: { errorToast: "..." }`;
// this handler turns that into a toast.
//
// WHEN AN OPTIMISTIC MUTATION ALSO NEEDS ONE. The default is silence, because the
// snap-back IS the signal. That holds for an in-place EDIT: the value you typed
// reverts under your cursor, so what failed and what to do are both obvious. It
// does not hold once the rollback is easy to miss, which is the case for:
//
//   - every optimistic DELETE/REMOVAL. The snap-back is a row REAPPEARING, after
//     the confirm has closed and the user's attention has moved on. That reads as
//     "the app didn't delete it" - a bug - rather than "the request failed, retry".
//   - bulk transforms (a change spread across rows, most of them off-screen).
//   - DRAG-DRIVEN writes - reorders, and moves between packing locations - where
//     the snap-back is indistinguishable from "the user dragged it back
//     themselves". The trigger is the gesture, not the verb: a move issued from a
//     row menu shares the mutation and is no more obvious.
//   - the first-list/create-list placeholder.
//
// THE MODAL RULE, which outranks all of the above. IF THE WRITE WAS ISSUED FROM A
// MODAL THAT IS STILL OPEN WHEN IT FAILS, the error belongs inline, beside the form,
// where the user can correct it and retry without losing what they entered. That is
// why GearItemDialog and CreateListFromSelectionDialog take a `saveError` prop, why
// the dialog's "create category" affordance keeps its own `categoryError`, and why
// the gear library's inline category editor holds its own (that one is not a modal,
// but it stays open and can say it in place, which is better than a toast). It
// applies to non-optimistic mutations too: a modal-bound write gets inline feedback
// rather than meta.errorToast. A modal-bound write that can outlive its modal being
// open (closed by another action, or unmounted) reports through
// src/lib/report-failure.ts, which picks inline or toast by what is on screen when
// the failure lands.
//
// A toast raised while a modal is open IS seen: src/components/Modal.tsx opens a
// native <dialog> with showModal(), which puts it in the browser's TOP LAYER and
// makes the rest of the page inert, so ToastViewport renders inside the topmost open
// Modal (src/lib/toast-host.ts). Until that existed a toast under a modal sat behind
// the backdrop and expired unseen, and this rule was stated as "a toast there is
// nothing at all"; the inline preference now rests on being next to the form. The
// remaining hazard: a <dialog> opened with showModal() anywhere but Modal.tsx
// registers no host and hides toasts again, so go through Modal.
//
// A non-modal surface that stays put - the trip-length and meal controls on the list
// page, say - can perfectly well be answered by a toast, and an in-place edit still
// needs nothing at all.
//
// The delete confirms, the gear library's bulk "Move to category" dialog, and mobile
// List options' Duplicate, Export CSV and Delete list close on the CLICK rather than
// on success. That was required while a modal still standing when the failure
// landed hid the toast explaining it; it is kept as their behavior, not re-decided
// here.
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { errorToast?: string }
  }
}

// Global default error handler for every useMutation in the app. Wired
// into the QueryClient via `mutationCache: new MutationCache({ onError:
// mutationErrorHandler })` in App.tsx. Per-mutation onError still wins
// for surfacing errors inline; this just guarantees no failed write
// disappears silently.
//
// Logged in every environment (not just DEV) so production failures are
// visible when a developer or technically-curious user opens DevTools.
// Deliberately uses console.warn rather than console.error: most mutation
// failures are recoverable (optimistic snap-back, user can retry), and
// reserving console.error for genuinely non-recoverable cases keeps the
// signal-to-noise ratio honest. A future Sentry/PostHog/etc. integration
// would wrap this call site - the structured payload is already the
// shape a reporter wants.
//
// Most mutation failures are surfaced inline at their call site (e.g.,
// GearItemDialog's transactional save shows the error in the dialog) or
// are silent optimistic rollbacks where the user sees the snap-back. We
// deliberately do NOT route every mutation failure through the toast
// system from here - that would spam users with toasts for transient
// network failures and background refetch errors. Which failures earn a
// toast is the rule stated at the top of this file; it is a rule rather
// than a per-site judgment call precisely so the answer does not drift
// between two surfaces doing the same thing.
//
// Extracted from the App.tsx inline arrow so the same function is
// consumed by both the production QueryClient and the unit test -
// duplicating the handler in the test would only test the copy.
export function mutationErrorHandler(
  error: unknown,
  _vars: unknown,
  _ctx: unknown,
  mutation: Mutation<unknown, unknown, unknown>,
): void {
  const key = mutation.options.mutationKey?.join('/') ?? 'mutation'
  const message = error instanceof Error ? error.message : String(error)
  // The server's id for the same incident, when it minted one (5xx that it
  // actually logged). This is the join between what the console shows and what
  // Workers Logs holds - without it, a client-side "Internal Server Error" and
  // the server entry that explains it cannot be tied together.
  const correlationId = error instanceof ApiError ? error.correlationId : undefined
  console.warn(`[${key}] failed`, {
    error: message,
    correlationId,
    mutationKey: mutation.options.mutationKey,
  })
  const errorToast = mutation.options.meta?.errorToast
  if (typeof errorToast === 'string') {
    showToast(errorToast, { type: 'error' })
  }
}
