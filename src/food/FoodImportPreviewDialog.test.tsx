// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import type { CreateFoodItemRequest } from '../../shared/food'
import type { FoodImportRow } from '../lib/csv'
import FoodImportPreviewDialog from './FoodImportPreviewDialog'

// jsdom has no native <dialog> support; Modal opens via showModal().
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true }
  HTMLDialogElement.prototype.close = function close() { this.open = false }
})

afterEach(cleanup)

function item(over: Partial<CreateFoodItemRequest> & { name: string }): CreateFoodItemRequest {
  return {
    name: over.name,
    brand: over.brand ?? null,
    servingDescription: over.servingDescription ?? null,
    servingWeightGrams: over.servingWeightGrams ?? 50,
    caloriesPerServing: over.caloriesPerServing ?? 200,
    servingsPerPackage: over.servingsPerPackage ?? null,
    fatGrams: over.fatGrams ?? null,
    saturatedFatGrams: over.saturatedFatGrams ?? null,
    carbsGrams: over.carbsGrams ?? null,
    fiberGrams: over.fiberGrams ?? null,
    sugarGrams: over.sugarGrams ?? null,
    proteinGrams: over.proteinGrams ?? null,
    sodiumMg: over.sodiumMg ?? null,
    potassiumMg: over.potassiumMg ?? null,
    notes: over.notes ?? null,
  }
}

function validRow(rowNumber: number, name: string): FoodImportRow {
  return { rowNumber, name, item: item({ name }), errors: [] }
}

function invalidRow(rowNumber: number, name: string, errors: string[]): FoodImportRow {
  return { rowNumber, name, item: null, errors }
}

function renderDialog(over: {
  rows: FoodImportRow[]
  existingCount?: number
  saving?: boolean
  onConfirm?: (items: CreateFoodItemRequest[]) => void
  onClose?: () => void
}) {
  return render(
    <FoodImportPreviewDialog
      rows={over.rows}
      existingCount={over.existingCount ?? 0}
      saving={over.saving ?? false}
      onConfirm={over.onConfirm ?? (() => {})}
      onClose={over.onClose ?? (() => {})}
    />,
  )
}

describe('FoodImportPreviewDialog', () => {
  it('renders every row and blocks Import while any row is invalid', () => {
    renderDialog({
      rows: [
        validRow(1, 'Oats'),
        invalidRow(2, 'Broken', ['Serving weight must be greater than 0']),
      ],
    })
    // Both rows render - the invalid one with its error text.
    expect(screen.getByText('Oats')).toBeTruthy()
    expect(screen.getByText('Broken')).toBeTruthy()
    expect(screen.getByText('Serving weight must be greater than 0')).toBeTruthy()
    expect(screen.getByText(/1 row needs fixing/i)).toBeTruthy()

    const importBtn = screen.getByRole('button', { name: /import 2 foods/i })
    expect(importBtn.hasAttribute('disabled')).toBe(true)
  })

  it('imports the parsed items when every row is valid', () => {
    const onConfirm = vi.fn()
    renderDialog({ rows: [validRow(1, 'Oats'), validRow(2, 'Bar')], onConfirm })

    const importBtn = screen.getByRole('button', { name: /import 2 foods/i })
    expect(importBtn.hasAttribute('disabled')).toBe(false)
    fireEvent.click(importBtn)
    expect(onConfirm).toHaveBeenCalledWith([item({ name: 'Oats' }), item({ name: 'Bar' })])
  })

  it('blocks an import that would exceed the library cap', () => {
    renderDialog({ rows: [validRow(1, 'Oats'), validRow(2, 'Bar')], existingCount: 999 })
    expect(screen.getByText(/exceed your food library limit/i)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /import 2 foods/i }).hasAttribute('disabled'),
    ).toBe(true)
  })
})
