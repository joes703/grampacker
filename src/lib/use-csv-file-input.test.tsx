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

  // A defect in the parser or the caller's handler must still reach the user,
  // not become an unhandled promise rejection (AGENTS.md: every rejected
  // promise has an owner).
  it('reports a parser that throws, and leaves nothing unhandled', async () => {
    const onError = vi.fn()
    const escaped: unknown[] = []
    const onRejection = (reason: unknown) => escaped.push(reason)
    // This tier's tsconfig has no node types; reach process structurally.
    const proc = (
      globalThis as unknown as {
        process: {
          on: (event: 'unhandledRejection', h: (reason: unknown) => void) => void
          off: (event: 'unhandledRejection', h: (reason: unknown) => void) => void
        }
      }
    ).process
    proc.on('unhandledRejection', onRejection)
    try {
      function Throwing() {
        const { inputRef, onChange } = useCsvFileInput(
          () => {
            throw new Error('parser defect')
          },
          { onParsed: vi.fn(), onError },
        )
        return <input ref={inputRef} type="file" data-testid="file" onChange={onChange} />
      }
      const { getByTestId } = render(<Throwing />)
      pick(getByTestId('file'), new File(['a'], 'gear.csv'))
      await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Couldn't import this file/)))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(escaped).toEqual([])
    } finally {
      proc.off('unhandledRejection', onRejection)
    }
  })
})
