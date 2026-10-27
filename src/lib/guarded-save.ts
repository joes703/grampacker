import type { Dispatch, SetStateAction } from 'react'
import { showToast } from './toast'

// The identity-guarded "attempt" save pattern for dialogs that stay open and
// stay DISMISSABLE while their save is out (abandoning a slow save is
// legitimate; the freeze-while-saving guard is what makes leaving safe).
//
// `attempt` is the EXACT state object the save was submitted from. Installing
// it makes it the current dialog (and, built as `{ ...dialog, saveError:
// null }`, clears the previous try's error). Every completion is then applied
// through `settle`, a functional update that runs only while `attempt` is
// still the open dialog - if the user has since closed it (prev === null),
// opened a different one, or hit Save again (each installs a fresh object),
// the late completion is a no-op. Without the guard, a slow rejection would
// re-open a dialog the user had already dismissed, remounted and therefore
// blank, and a slow success would close whichever dialog they opened next.
// Identity, not ids: reopening the SAME record must not inherit an abandoned
// attempt's completion.
//
// `setSaving` is the optional per-attempt saving slot (never a shared
// mutation's isPending, which inline row writes behind the dialog also
// raise). It is cleared in a `finally`, functionally, so an older attempt
// settling cannot unfreeze a newer attempt whose own request is still out.
//
// `run` owns its failures: every await inside it is caught and settled into
// state the user can see (usually a saveError on the attempt). A rejection
// that still escapes `run` is a defect: it is logged, and the user is told
// the save is unconfirmed, so no promise is left without an owner.

export type SettleAttempt<S> = (next: (prev: S) => S | null) => void

export function runGuardedSave<S extends object>({
  attempt,
  setState,
  setSaving,
  run,
}: {
  attempt: S
  setState: Dispatch<SetStateAction<S | null>>
  setSaving?: Dispatch<SetStateAction<S | null>>
  run: (settle: SettleAttempt<S>) => Promise<void>
}): void {
  setState(attempt)
  setSaving?.(attempt)
  const settle: SettleAttempt<S> = (next) =>
    setState((prev) => (prev === attempt ? next(prev) : prev))
  void (async () => {
    try {
      await run(settle)
    } catch (error) {
      console.error('runGuardedSave: run rejected', error)
      showToast("Couldn't confirm the save. Refresh to check before trying again.", { type: 'error' })
    } finally {
      setSaving?.((prev) => (prev === attempt ? null : prev))
    }
  })()
}
