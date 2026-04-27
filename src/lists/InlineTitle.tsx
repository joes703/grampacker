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

  return (
    <h1
      onClick={() => { setDraft(name); setEditing(true) }}
      title="Click to rename"
      className="flex-1 min-w-0 cursor-text truncate rounded px-2 py-0.5 -mx-2 text-xl font-semibold text-gray-900 hover:bg-gray-100"
    >
      {name}
    </h1>
  )
}
