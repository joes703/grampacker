// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AddEntryDialog } from './EntryDialog'
import type { FoodItem } from '../lib/types'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
  HTMLDialogElement.prototype.close = function close() { this.open = false }
})

afterEach(cleanup)

const food: FoodItem = {
  id: 'food-1',
  name: 'Ramen',
  brand: null,
  servingDescription: null,
  servingWeightGrams: 85,
  caloriesPerServing: 380,
  servingsPerPackage: null,
  fatGrams: null,
  saturatedFatGrams: null,
  carbsGrams: null,
  fiberGrams: null,
  sugarGrams: null,
  proteinGrams: null,
  sodiumMg: null,
  potassiumMg: null,
  notes: null,
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

describe('AddEntryDialog', () => {
  it('names the food-library search control', () => {
    render(
      <AddEntryDialog
        targetLabel="Day 1 breakfast"
        foods={[food]}
        onAdd={vi.fn()}
        onClose={vi.fn()}
        saving={false}
        saveError={null}
      />,
    )

    expect(screen.getByRole('searchbox', { name: 'Search foods to add' })).toBeInTheDocument()
  })
})
