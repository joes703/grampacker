import { Plus } from 'lucide-react'
import type { PackingLocation } from '../lib/types'
import { MAX_PACKING_LOCATION_NAME, PACKING_LOCATION_CAP } from '../lib/caps'

// Create a packing location, plus the first-run nudge. Lifted from the
// retired OrganizePackPanel: a list with no locations groups by gear category
// (selectPackGrouping), which is a fine checklist but not a packing plan, so
// this is the on-ramp from one to the other.
export default function PackLocationControls({
  locations,
  locationsResolved,
  loadFailed,
  onRetry,
  creationPending,
  draft,
  onDraftChange,
  onCreate,
}: {
  locations: PackingLocation[]
  /** Has the locations query actually answered? An empty array alone cannot
   *  tell "this list has no locations" from "we haven't loaded them yet". */
  locationsResolved: boolean
  /** The query settled in error. Distinct from !locationsResolved, which is
   *  also true while it is merely in flight - only a settled failure has
   *  something to tell the user and something to retry. */
  loadFailed: boolean
  onRetry: () => void
  creationPending: boolean
  draft: string
  onDraftChange: (value: string) => void
  onCreate: (name: string) => void
}) {
  const trimmed = draft.trim()
  const atCap = locations.length >= PACKING_LOCATION_CAP
  // noValidate makes maxLength inert for SUBMIT purposes (AGENTS.md), so the
  // length check is manual here and the server is the real gate.
  //
  // locationsResolved is part of this, not just of the nudge below: an
  // unresolved query means `locations` is [] because we do not know, which
  // makes the cap check above vacuous and hands the optimistic insert a slot
  // computed against no locations at all.
  const canSubmit =
    locationsResolved && Boolean(trimmed) && trimmed.length <= 60 && !atCap && !creationPending

  return (
    <div className="space-y-3 print:hidden">
      {/* Sits with the control it explains, and OUTSIDE the items branch this
          notice used to live in - an empty list whose locations failed showed a
          disabled Add with no reason given and no way to recover. */}
      {loadFailed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Couldn&apos;t load packing locations. Showing the last available grouping.</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-amber-400 bg-white px-2.5 py-1 text-sm font-medium text-amber-900 hover:bg-amber-100"
          >
            Retry
          </button>
        </div>
      )}
      <form
        noValidate
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit) return
          onCreate(trimmed)
        }}
      >
        <label className="sr-only" htmlFor="new-packing-location">New packing location</label>
        <input
          id="new-packing-location"
          value={draft}
          maxLength={MAX_PACKING_LOCATION_NAME}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="Add a location, e.g. Main pack"
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={15} /> Add
        </button>
      </form>
      {atCap ? (
        <p className="text-sm text-amber-800">
          This list has the maximum of {PACKING_LOCATION_CAP} packing locations.
        </p>
      ) : null}

      {locationsResolved && locations.length === 0 ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="text-sm font-semibold text-blue-950">Start with where your gear lives</h2>
          <p className="mt-1 text-sm text-blue-900">
            Add one or more pack locations. Your checklist will switch from gear categories to these locations.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Main pack', 'Top lid', 'Hip belt pockets'].map((name) => (
              <button
                key={name}
                type="button"
                disabled={creationPending}
                onClick={() => onCreate(name)}
                className="rounded-md border border-blue-300 bg-white px-2.5 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
