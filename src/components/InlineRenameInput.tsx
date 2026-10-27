import { useEffect, useRef } from 'react'
import { useCommitOnce } from '../lib/use-commit-once'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  /** Select the whole value on mount (the rename-in-place default). False
   *  just focuses, for surfaces where typing should extend the draft. */
  selectOnOpen?: boolean
  ariaLabel?: string
  /** Full input chrome per surface (e.g. LIST_RENAME_INPUT_CLASS). */
  className?: string
  maxLength?: number
}

// The inline-rename machine, in one place: focus/select on mount, Enter
// commits, Escape cancels, blur commits, and useCommitOnce arbitrates the
// same-batch double delivery (Enter then blur must not commit twice; Escape
// then blur must not turn a cancel into a save). Parents own the draft value and what commit
// and cancel mean; an async submit still needs its own in-flight guard
// (useCommitOnce re-arms every render - see its scope note).
export default function InlineRenameInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  selectOnOpen = true,
  ariaLabel,
  className,
  maxLength,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const commitOnce = useCommitOnce()

  useEffect(() => {
    if (selectOnOpen) inputRef.current?.select()
    else inputRef.current?.focus()
  }, [selectOnOpen])

  return (
    <input
      ref={inputRef}
      autoFocus
      type="text"
      value={value}
      aria-label={ariaLabel}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commitOnce(onSubmit)
        if (e.key === 'Escape') commitOnce(onCancel)
      }}
      onBlur={() => commitOnce(onSubmit)}
      className={className}
    />
  )
}
