// @vitest-environment jsdom
import { afterEach, describe, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import FoodRow from './FoodRow'
import { expectNameCanShrink } from '../test/row-shrink'

afterEach(cleanup)

// On a phone a long name must truncate, not push the weight off the row.
describe('FoodRow mobile name', () => {
  it('can shrink', () => {
    const { container } = render(
      <FoodRow
        food={{ id: 'food-1', name: 'Oatmeal', unitCount: 2, weightGrams: 90 }}
        weightUnit="g"
        isBelowLg
      />,
    )
    expectNameCanShrink(screen.getByText('Oatmeal'), container.firstElementChild as HTMLElement)
  })
})
