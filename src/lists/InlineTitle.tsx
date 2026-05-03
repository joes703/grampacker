import { useState, useRef, useEffect } from 'react'

type Props = {
  name: string
  onSave: (next: string) => void
  // Increment to enter edit mode externally. The display-mode click-to-edit
  // moved to the parent's pencil button, so this is the only entry point
  // into edit mode. Mirrors the focusSearchTrigger counter idiom from
  // LibraryPanel — skipInitialEdit guards the mount-time effect run.
  editTrigger?: number
  // Notifies the parent when edit mode starts/ends so the parent can
  // suppress its own click handlers (e.g. the list-switcher container's
  // open-selector click) and hide the pencil affordance during edit.
  onEditingChange?: (editing: boolean) => void
}

// Inline rename for the top bar's list name on /lists/:id. The display
// element is now a plain <h1>; the rename trigger lives outside this
// component (a pencil button in NavBar's ListHeading) so the surrounding
// list-switcher container can claim mouse clicks for the more frequent
// switch-list action.
//
// Validation: empty trimmed name on explicit save (Enter) renders an inline
// red error below the input and keeps the input in edit mode so the user
// can fix or Escape to revert. The error clears on the next keystroke or on
// Escape. Empty on blur is treated as an implicit cancel — the input exits
// edit mode silently rather than stranding an unfocused error.
export default function InlineTitle({ name, onSave, editTrigger, onEditingChange }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Capture the editTrigger value at mount, then compare on every effect
  // run. The earlier "skip flag mutated inside the effect" pattern broke
  // under StrictMode's dev-only double-effect: first run mutates the
  // flag, second run sees the mutated value and falls through to
  // startEdit(). Reading the initial value into a ref and never mutating
  // it sidesteps the issue — both StrictMode runs see initial===current
  // and skip.
  const initialEditTrigger = useRef(editTrigger)

  function startEdit() {
    setDraft(name)
    setError(null)
    setEditing(true)
  }

  function cancel() {
    setDraft(name)
    setError(null)
    setEditing(false)
  }

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  useEffect(() => {
    if (editTrigger === initialEditTrigger.current) return
    startEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit is stable; only editTrigger changes drive entry
  }, [editTrigger])

  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  function commit({ explicit }: { explicit: boolean }) {
    const trimmed = draft.trim()
    if (!trimmed) {
      if (explicit) {
        setError("List name can't be empty")
        return
      }
      // Implicit blur on empty — treat as cancel.
      cancel()
      return
    }
    if (trimmed !== name) onSave(trimmed)
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="relative flex-1 min-w-0">
        <input
          ref={inputRef}
          value={draft}
          maxLength={256}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onBlur={() => commit({ explicit: false })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit({ explicit: true })
            if (e.key === 'Escape') cancel()
          }}
          aria-invalid={error !== null}
          className="w-full rounded border border-blue-400 bg-white px-2 py-0.5 text-xl font-semibold text-gray-900 focus:outline-none"
        />
        {error && (
          // Positioned below the bar so it doesn't push the topbar's
          // h-14 layout. Container has no overflow clip, so this renders
          // freely. pointer-events-none — the message is informational
          // only, the input is the actionable element.
          <p className="pointer-events-none absolute left-0 top-full mt-1 px-1 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    )
  }

  // Plain heading — no inner button, no click-to-edit. The list-switcher
  // container in NavBar owns the click target (opens the selector); rename
  // entry comes from the sibling pencil affordance.
  return (
    <h1 className="flex-1 min-w-0 truncate px-2 py-0.5 text-xl font-semibold text-gray-900">
      {name}
    </h1>
  )
}
