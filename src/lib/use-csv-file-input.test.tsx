// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { useCsvFileInput } from './use-csv-file-input'

afterEach(cleanup)

function Probe(props: { onParsed: (rows: string[], name: string) => void; onError: (m: string) => void }) {
  const { inputRef, onChange } = useCsvFileInput((text) => text.split('\n'), props)
  return <input ref={inputRef} type="file" data-testid="file" onChange={onChange} />
}

function pick(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
}

describe('useCsvFileInput', () => {
  it('parses the file text', async () => {
    const onParsed = vi.fn()
    const { getByTestId } = render(<Probe onParsed={onParsed} onError={vi.fn()} />)
    pick(getByTestId('file'), new File(['a\nb'], 'gear.csv'))
    await waitFor(() => expect(onParsed).toHaveBeenCalledWith(['a', 'b'], 'gear.csv'))
  })

  // A read failure (corrupt file, permission denied, removed media) must
  // reach the caller, or the import surface waits forever.
  it('reports a file that cannot be read', async () => {
    const onError = vi.fn()
    const onParsed = vi.fn()
    const file = new File(['a'], 'gear.csv')
    vi.spyOn(file, 'text').mockRejectedValue(new DOMException('denied', 'NotReadableError'))
    const { getByTestId } = render(<Probe onParsed={onParsed} onError={onError} />)
    pick(getByTestId('file'), file)
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Couldn't read this file/)))
    expect(onParsed).not.toHaveBeenCalled()
  })
})
