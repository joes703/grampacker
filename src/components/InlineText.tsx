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
  // Sync draft to external value changes via the React-docs "store-previous-prop"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // setState during render — React reruns the component immediately on a real
  // change, so the input never sees a stale draft. Avoids the cascading-render
  // pitfall flagged by react-hooks/set-state-in-effect.
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(value)
  }
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Render as a transparent <button> so the click-to-edit trigger is
  // keyboard-reachable (Tab + Enter/Space). The button inherits the
  // surrounding typography via the className passed in by callers.
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={title}
      className={`cursor-text rounded bg-transparent px-1 py-0.5 text-left font-[inherit] text-[length:inherit] text-[color:inherit] hover:bg-gray-100 ${className}`}
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </button>
  )
}
