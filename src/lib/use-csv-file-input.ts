import { useCallback, useRef, type ChangeEventHandler } from 'react'

// Wires a hidden <input type="file"> to a CSV parser.
//
// - Bind `inputRef` to the hidden input's ref.
// - Bind `onChange` to its onChange.
// - Call `openPicker()` to programmatically open the file picker.
//
// The input is reset after every change so re-selecting the same file works.
// `openPicker` is stable across renders so consumers can put it in
// useEffect dep arrays without dragging the ref in.
export function useCsvFileInput<T>(
  parser: (text: string) => T[] | string,
  handlers: {
    onParsed: (rows: T[]) => void
    onError: (message: string) => void
  },
): {
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: ChangeEventHandler<HTMLInputElement>
  openPicker: () => void
} {
  const inputRef = useRef<HTMLInputElement>(null)

  const onChange: ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const result = parser(text)
      if (typeof result === 'string') handlers.onError(result)
      else handlers.onParsed(result)
    }
    reader.readAsText(file)
  }

  const openPicker = useCallback(() => {
    inputRef.current?.click()
  }, [])

  return { inputRef, onChange, openPicker }
}
