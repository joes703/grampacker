import { ApiError } from './api'

// What to say when a CSV import fails. After a server failure or a dropped
// connection the import may still have gone through, and retrying could create
// a duplicate, so the user is told to check first (AGENTS.md "Traps"). A refusal
// or a cap check before the request means nothing was imported, and its message
// says what to fix.
export function importErrorMessage(err: unknown, checkPlace: 'lists' | 'inventory'): string {
  const outcomeUnknown =
    !(err instanceof Error) ||
    err instanceof TypeError ||
    (err instanceof ApiError && err.status >= 500)
  return outcomeUnknown
    ? `Couldn't confirm the import. Check your ${checkPlace} before trying again.`
    : err.message
}
