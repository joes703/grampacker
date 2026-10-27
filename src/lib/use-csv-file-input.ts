import { useCallback, useRef, type ChangeEventHandler } from 'react'

const MAX_CSV_BYTES = 2 * 1024 * 1024 // 2 MB byte cap for CSV uploads

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
    // The promise is owned here: a read failure (corrupt file, permission
    // denied, removed media) is reported, or the import surface would wait
    // forever with nothing shown; a throw from the parser or the caller's
    // handler is reported too, never left unhandled.
    file
      .text()
      .then(
        (text) => {
          const parsed = parser(text)
          if (typeof parsed === 'string') handlers.onError(parsed)
          else handlers.onParsed(parsed, filename)
        },
        () =>
          handlers.onError(
            "Couldn't read this file. It may be corrupt or your browser may have blocked file access. Try a different file.",
          ),
      )
      .catch((error: unknown) => {
        console.error('CSV import failed', error)
        handlers.onError("Couldn't import this file. Please try again.")
      })
  }

  const openPicker = useCallback(() => {
    inputRef.current?.click()
  }, [])

  return { inputRef, onChange, openPicker }
}
