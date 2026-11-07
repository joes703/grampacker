// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CsvHeaderLine from './CsvHeaderLine'
import { CSV_HEADER_LINE } from '../lib/csv'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('CsvHeaderLine', () => {
  it('shows the row and copies it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CsvHeaderLine />)

    expect(screen.getByText(CSV_HEADER_LINE)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(writeText).toHaveBeenCalledWith(CSV_HEADER_LINE)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('stays on Copy when the browser refuses, and the row can still be selected', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<CsvHeaderLine />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByText(CSV_HEADER_LINE)).toHaveClass('select-all')
  })
})
