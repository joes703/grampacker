import { describe, expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import { runGuardedSave } from './guarded-save'
import { showToast } from './toast'

vi.mock('./toast', () => ({ showToast: vi.fn() }))

// The page-level pins live in GearLibraryPage.save-errors.test.tsx and
// ListDetailPage.edit-gear.test.tsx (late completions against the real
// dialogs). This file pins the primitive's own contract with a bare state
// cell, where each guarantee is one assertion.

type Dialog = { id: string; saveError: string | null }

// A minimal useState stand-in: applies functional updates immediately.
function cell<T>(initial: T) {
  const box = { value: initial }
  const set = (action: SetStateAction<T>) => {
    box.value =
      typeof action === 'function' ? (action as (prev: T) => T)(box.value) : action
  }
  return { box, set }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('runGuardedSave', () => {
  it('installs the attempt in both slots, then clears only the saving slot', async () => {
    const dialog = cell<Dialog | null>(null)
    const saving = cell<Dialog | null>(null)
    const attempt: Dialog = { id: 'a', saveError: null }
    const d = deferred()
    runGuardedSave<Dialog>({
      attempt,
      setState: dialog.set,
      setSaving: saving.set,
      run: async (settle) => {
        await d.promise
        settle(() => null)
      },
    })
    expect(dialog.box.value).toBe(attempt)
    expect(saving.box.value).toBe(attempt)
    d.resolve()
    await d.promise
    await Promise.resolve()
    expect(dialog.box.value).toBeNull()
    expect(saving.box.value).toBeNull()
  })

  it('a settle landing after the attempt was replaced is a no-op', async () => {
    const dialog = cell<Dialog | null>(null)
    const attempt: Dialog = { id: 'a', saveError: null }
    const d = deferred()
    runGuardedSave<Dialog>({
      attempt,
      setState: dialog.set,
      run: async (settle) => {
        await d.promise
        settle((prev) => ({ ...prev, saveError: 'late failure' }))
      },
    })
    // The user closed the dialog and opened another with the SAME id: only
    // object identity separates it from the attempt.
    const reopened: Dialog = { id: 'a', saveError: null }
    dialog.set(reopened)
    d.resolve()
    await d.promise
    await Promise.resolve()
    expect(dialog.box.value).toBe(reopened)
    expect(dialog.box.value?.saveError).toBeNull()
  })

  it("an older attempt settling does not clear a newer attempt's saving slot", async () => {
    const dialog = cell<Dialog | null>(null)
    const saving = cell<Dialog | null>(null)
    const first = deferred()
    runGuardedSave<Dialog>({
      attempt: { id: 'a', saveError: null },
      setState: dialog.set,
      setSaving: saving.set,
      run: async () => {
        await first.promise
      },
    })
    const second: Dialog = { id: 'b', saveError: null }
    const d2 = deferred()
    runGuardedSave<Dialog>({
      attempt: second,
      setState: dialog.set,
      setSaving: saving.set,
      run: async () => {
        await d2.promise
      },
    })
    first.resolve()
    await first.promise
    await Promise.resolve()
    // Still saving: the second attempt's own request has not come back.
    expect(saving.box.value).toBe(second)
    d2.resolve()
    await d2.promise
    await Promise.resolve()
    expect(saving.box.value).toBeNull()
  })

  // AGENTS.md: every rejected promise has an owner. A rejection escaping
  // `run` is a defect in the caller, but the user still learns the save may
  // not have happened, and nothing is left unhandled.
  it('reports a rejection escaping run, clears the saving slot, and leaves nothing unhandled', async () => {
    const saving = cell<Dialog | null>(null)
    const attempt: Dialog = { id: 'a', saveError: null }
    let escaped: unknown = null
    const handler = (reason: unknown) => {
      escaped = reason
    }
    // This tier's tsconfig has no node types; reach process structurally.
    const proc = (
      globalThis as unknown as {
        process: {
          on: (event: 'unhandledRejection', h: (reason: unknown) => void) => void
          removeListener: (
            event: 'unhandledRejection',
            h: (reason: unknown) => void,
          ) => void
        }
      }
    ).process
    proc.on('unhandledRejection', handler)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      runGuardedSave<Dialog>({
        attempt,
        setState: () => {},
        setSaving: saving.set,
        run: async () => {
          throw new Error('defect')
        },
      })
      // Give a rejection a macrotask to be reported as unhandled.
      await new Promise((res) => setTimeout(res, 0))
      await new Promise((res) => setTimeout(res, 0))
      expect(saving.box.value).toBeNull()
      expect(escaped).toBeNull()
      expect(showToast).toHaveBeenCalledWith(
        "Couldn't confirm the save. Refresh to check before trying again.",
        { type: 'error' },
      )
    } finally {
      proc.removeListener('unhandledRejection', handler)
      error.mockRestore()
    }
  })
})
