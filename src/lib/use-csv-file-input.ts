import { useCallback, useRef, type ChangeEventHandler } from 'react'

const MAX_CSV_BYTES = 2 * 1024 * 1024 // 2 MB; matches SPEC.md

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
    onParsed: (rows: T[], filename: string) => void
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
    if (file.size > MAX_CSV_BYTES) {
      handlers.onError(
        'This CSV is larger than 2 MB. Try splitting it into smaller files or check that you uploaded the right file.',
      )
      return
    }
    const filename = file.name
    const reader = new FileReader()
    reader.onload = (ev) => {
      // FileReader.result is `string | ArrayBuffer | null`. We invoked
      // readAsText(), so a string is the expected shape — but narrow it
      // explicitly rather than casting so a future caller switching to
      // readAsArrayBuffer() doesn't silently feed bytes to a text parser.
      const result = ev.target?.result
      if (typeof result !== 'string') return
      const parsed = parser(result)
      if (typeof parsed === 'string') handlers.onError(parsed)
      else handlers.onParsed(parsed, filename)
    }
    reader.readAsText(file)
  }

  const openPicker = useCallback(() => {
    inputRef.current?.click()
  }, [])

  return { inputRef, onChange, openPicker }
}
