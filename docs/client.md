# Client rules and traps

**Binding, kept current with the code.** Read before changing anything under
`src/`. Before building a surface or form, also read `docs/ui-density.md`
(the density tiers, design tokens and form rules).

## Loading is not empty

An empty array also means "loading" or "failed", and only "nothing" may be
written against.

- Gate reads on `isLoadingError`, then `isPending`.
- Gate write actions, not just the render, on the collection having resolved.
- Never gate the way out: Cancel, and actions with their own preflight, stay
  reachable.

## Failures the user can see

A failure the user cannot see is not reported.

- A `<dialog>` opened with `showModal()` covers and inerts everything outside
  it, so open dialogs only through `Modal`, which hosts the toast region while
  open (`src/lib/toast-host.ts`). A modal still reports its own failures
  inline, beside the form.
- `src/lib/mutation-error-handler.ts` owns which failures toast.
- Error copy claims only what it can prove ("Couldn't confirm...", not
  "Couldn't delete..."). A rejected response does not prove that a
  non-idempotent request did not commit, so tell the user to refresh or check
  the result before retrying.

## Every rejected promise has an owner

Lint (`no-floating-promises`) catches an un-awaited call. Beyond that, an
async handler called without `await` or `.catch` catches internally, or
returns a promise its call site awaits. A non-mutation async action reports
the error, then consumes it, rather than rethrowing into nothing.

## Links

`target="_blank"` always comes with `rel="noopener noreferrer"`, so the
opened page cannot reach `window.opener` or see the referrer.
