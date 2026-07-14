import { useState, useRef, useEffect } from 'react'
import { INLINE_EDIT_FOCUS_RING } from './flat-table-styles'
import { useCommitOnce } from '../lib/use-commit-once'

type Props = {
  value: string
  placeholder?: string
  onSave: (v: string) => void
  className?: string
  /** Edit title hint shown on hover */
  title?: string
}

export default function InlineText({
  value,
  placeholder,
  onSave,
  className = '',
  title = 'Edit',
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
  const commitOnce = useCommitOnce()

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
        onBlur={() => commitOnce(save)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitOnce(save)
          if (e.key === 'Escape') commitOnce(() => { setDraft(value); setEditing(false) })
        }}
        className={`rounded border border-blue-400 px-1 py-0.5 text-sm ${INLINE_EDIT_FOCUS_RING} ${className}`}
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
      {/* gray-600, not the usual gray-500 muted token: this button sets
          hover:bg-gray-100, and gray-500 on gray-100 is 4.39:1 - just under the
          4.5:1 floor, in the exact state a user puts it in on the way to
          clicking. gray-600 is 6.87:1 there. */}
      {value || <span className="text-gray-600 italic">{placeholder}</span>}
    </button>
  )
}
