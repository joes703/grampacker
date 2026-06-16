// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import FoodCsvFormatDialog from './FoodCsvFormatDialog'
import { FOOD_CSV_HEADER } from '../lib/csv'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FoodCsvFormatDialog', () => {
  it('renders the canonical header block and the required-field help', () => {
    render(<FoodCsvFormatDialog onClose={() => {}} />)
    expect(screen.getByText(FOOD_CSV_HEADER)).toBeInTheDocument()
    expect(screen.getByText(/Required:/)).toBeInTheDocument()
    expect(screen.getByText(/GearSkeptic/)).toBeInTheDocument()
  })

  it('copies the canonical header to the clipboard and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<FoodCsvFormatDialog onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /copy header/i }))

    expect(writeText).toHaveBeenCalledWith(FOOD_CSV_HEADER)
    // Success feedback: the button flips to a "Copied" confirmation.
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })
})
