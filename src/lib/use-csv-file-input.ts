import { useRef, type ChangeEventHandler } from 'react'

// Wires a hidden <input type="file"> to a CSV parser. Caller binds inputRef +
// onChange to the input and calls inputRef.current?.click() to open the file
// picker. The input is reset after every change so re-selecting the same file
// works.
export function useCsvFileInput<T>(
  parser: (text: string) => T[] | string,
  handlers: {
    onParsed: (rows: T[]) => void
    onError: (message: string) => void
  },
): {
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: ChangeEventHandler<HTMLInputElement>
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

  return { inputRef, onChange }
}
