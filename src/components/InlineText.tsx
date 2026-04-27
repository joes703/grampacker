import { useState, useRef, useEffect } from 'react'

type Props = {
  value: string
  placeholder?: string
  onSave: (v: string) => void
  className?: string
  /** Click-to-edit title hint shown on hover */
  title?: string
}

export default function InlineText({
  value,
  placeholder,
  onSave,
  className = '',
  title = 'Click to edit',
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={`rounded border border-blue-400 px-1 py-0.5 text-sm focus:outline-none ${className}`}
      />
    )
  }

  return (
    <span
      onClick={() => setEditing(true)}
      title={title}
      className={`cursor-text rounded px-1 py-0.5 hover:bg-gray-100 ${className}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </span>
  )
}
