// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { FoodPackRow } from '../food/pack-rows'
import FoodPackSection from './FoodPackSection'

afterEach(cleanup)

function row(over: Partial<FoodPackRow> = {}): FoodPackRow {
  return {
    foodItemId: 'f1',
    name: 'Ramen',
    brand: null,
    grams: 85,
    estimate: false,
    packed: false,
    ...over,
  }
}

function renderSection(over: Partial<Parameters<typeof FoodPackSection>[0]> = {}) {
  const onToggle = vi.fn<(foodItemId: string, packed: boolean) => void>()
  const utils = render(
    <FoodPackSection
      rows={[row()]}
      weightUnit="g"
      showUnpackedOnly={false}
      onToggle={onToggle}
      {...over}
    />,
  )
  return { onToggle, ...utils }
}

describe('FoodPackSection', () => {
  it('renders one checkbox row per food', () => {
    renderSection({
      rows: [
        row(),
        row({ foodItemId: 'f2', name: 'Oats', packed: true }),
      ],
    })
    expect(screen.getByRole('checkbox', { name: 'Pack Ramen' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Pack Oats' })).toBeChecked()
  })

  it('reports a toggle with the next state', async () => {
    const user = userEvent.setup()
    const { onToggle } = renderSection({
      rows: [row(), row({ foodItemId: 'f2', name: 'Oats', packed: true })],
    })
    await user.click(screen.getByRole('checkbox', { name: 'Pack Ramen' }))
    expect(onToggle).toHaveBeenCalledWith('f1', true)
    await user.click(screen.getByRole('checkbox', { name: 'Pack Oats' }))
    expect(onToggle).toHaveBeenCalledWith('f2', false)
  })

  it('show-unpacked-only hides packed rows and renders nothing when all are packed', () => {
    const { rerender, container } = renderSection({
      rows: [row({ packed: true }), row({ foodItemId: 'f2', name: 'Oats' })],
      showUnpackedOnly: true,
    })
    expect(screen.queryByText('Ramen')).toBeNull()
    expect(screen.getByText('Oats')).toBeTruthy()

    rerender(
      <FoodPackSection
        rows={[row({ packed: true })]}
        weightUnit="g"
        showUnpackedOnly
        onToggle={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('keeps a food missing from the library packable under a fallback name', async () => {
    // Nothing blocks packing (decided 2026-07-17): the entry is in the plan,
    // so the server accepts the checkmark even while the client cannot name
    // the food yet.
    const user = userEvent.setup()
    const { onToggle } = renderSection({
      rows: [row({ foodItemId: 'f-gone', name: null, grams: 0, estimate: true })],
    })
    const checkbox = screen.getByRole('checkbox', { name: 'Pack Unknown food' })
    expect(checkbox).not.toBeDisabled()
    await user.click(checkbox)
    expect(onToggle).toHaveBeenCalledWith('f-gone', true)
  })

  it('marks estimate rows', () => {
    renderSection({ rows: [row({ estimate: true })] })
    expect(screen.getByText(/Estimate/)).toBeTruthy()
  })

  it('shows the brand as a meta line when present', () => {
    renderSection({ rows: [row({ brand: 'Nissin' })] })
    expect(screen.getByText('Nissin')).toBeTruthy()
  })
})
