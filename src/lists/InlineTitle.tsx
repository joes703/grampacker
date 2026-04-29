import { useState, useRef, useEffect } from 'react'

type Props = {
  name: string
  onSave: (next: string) => void
}

// Click-to-rename for the page-level <h1>. Same gesture as InlineText, but
// styled as a heading and conditionally focuses+selects the input on edit.
export default function InlineTitle({ name, onSave }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== name) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={256}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(name); setEditing(false) }
        }}
        className="flex-1 min-w-0 rounded border border-blue-400 bg-white px-2 py-0.5 text-xl font-semibold text-gray-900 focus:outline-none"
      />
    )
  }

  // Visual is still an <h1> for document outline; the inner element is a
  // transparent <button> so the rename trigger is keyboard-reachable
  // (Tab + Enter/Space). Reset styles let the button inherit the heading's
  // typography exactly. The native focus ring is preserved for keyboard
  // users via :focus-visible (Tailwind preflight already adds outline:none
  // for non-keyboard focus).
  return (
    <h1 className="flex-1 min-w-0 -mx-2">
      <button
        type="button"
        onClick={() => { setDraft(name); setEditing(true) }}
        title="Click to rename"
        className="block w-full cursor-text truncate rounded bg-transparent px-2 py-0.5 text-left text-xl font-semibold text-gray-900 hover:bg-gray-100"
      >
        {name}
      </button>
    </h1>
  )
}
