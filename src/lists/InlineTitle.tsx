import { useState, useRef, useEffect } from 'react'

type Props = {
  name: string
  onSave: (next: string) => void
}

// Click-to-rename, used by the top bar on /lists/:id. The visible element
// is a <button> styled as a heading; click puts it into edit mode. The
// surrounding container (in NavBar's ListHeading) provides the hover/rest
// background; this component contributes only the cursor-text affordance
// over the name area, distinguishing it from the adjacent chevron (the
// list-switch affordance).
//
// Validation: empty trimmed name on explicit save (Enter) renders an inline
// red error below the input and keeps the input in edit mode so the user
// can fix or Escape to revert. The error clears on the next keystroke or on
// Escape. Empty on blur is treated as an implicit cancel — the input exits
// edit mode silently rather than stranding an unfocused error.
export default function InlineTitle({ name, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

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

  // Visual is still an <h1> for document outline; the inner element is a
  // transparent <button> so the rename trigger is keyboard-reachable
  // (Tab + Enter/Space). The container's hover bg comes from the wrapping
  // ListHeading div; this button only contributes cursor-text to signal
  // editability over the name area specifically.
  return (
    <h1 className="flex-1 min-w-0">
      <button
        type="button"
        onClick={startEdit}
        title="Click to rename"
        className="block w-full cursor-text truncate bg-transparent px-2 py-0.5 text-left text-xl font-semibold text-gray-900"
      >
        {name}
      </button>
    </h1>
  )
}
