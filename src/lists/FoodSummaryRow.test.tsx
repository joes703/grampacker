// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import FoodSummaryRow from './FoodSummaryRow'

afterEach(cleanup)

describe('FoodSummaryRow', () => {
  it('renders the Food label, the From Food plan note, and a weight', () => {
    render(<FoodSummaryRow grams={318} />)
    expect(screen.getByText('Food')).toBeTruthy()
    expect(screen.getByText('From Food plan')).toBeTruthy()
    // weight rendered by TotalWeightValue (default unit); assert the section.
    expect(screen.getByLabelText('Food carried from plan')).toBeTruthy()
  })
})
