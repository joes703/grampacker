// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useQuickAddForm } from './use-quick-add-form'

afterEach(() => {
  cleanup()
})

describe('useQuickAddForm', () => {
  it('starts empty and cannot submit', () => {
    const { result } = renderHook(() => useQuickAddForm())
    expect(result.current.name).toBe('')
    expect(result.current.description).toBe('')
    expect(result.current.weightGrams).toBe(0)
    expect(result.current.quantity).toBe('1')
    expect(result.current.worn).toBe(false)
    expect(result.current.consumable).toBe(false)
    expect(result.current.canSubmit).toBe(false)
    expect(result.current.buildData()).toBeNull()
  })

  it('canSubmit tracks a non-blank name', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => result.current.setName('  '))
    expect(result.current.canSubmit).toBe(false)
    act(() => result.current.setName('Tent'))
    expect(result.current.canSubmit).toBe(true)
  })

  it('worn and consumable are mutually exclusive', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => result.current.toggleWorn())
    expect(result.current.worn).toBe(true)
    expect(result.current.consumable).toBe(false)

    act(() => result.current.toggleConsumable())
    expect(result.current.consumable).toBe(true)
    expect(result.current.worn).toBe(false)

    act(() => result.current.toggleWorn())
    expect(result.current.worn).toBe(true)
    expect(result.current.consumable).toBe(false)

    // Toggling the active one off leaves both false.
    act(() => result.current.toggleWorn())
    expect(result.current.worn).toBe(false)
    expect(result.current.consumable).toBe(false)
  })

  it('buildData returns null for a whitespace-only name', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => result.current.setName('   '))
    expect(result.current.buildData()).toBeNull()
  })

  it('buildData trims and slices name and description', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => {
      result.current.setName(`  ${'x'.repeat(300)}  `)
      result.current.setDescription('   ')
    })
    let data = result.current.buildData()
    expect(data?.name).toHaveLength(256)
    expect(data?.description).toBeNull()

    act(() => result.current.setDescription('  packed weight notes  '))
    data = result.current.buildData()
    expect(data?.description).toBe('packed weight notes')
  })

  it('buildData clamps weight to 0..100000', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => result.current.setName('Quilt'))

    act(() => result.current.setWeightGrams(999999))
    expect(result.current.buildData()?.weight_grams).toBe(100000)

    act(() => result.current.setWeightGrams(-50))
    expect(result.current.buildData()?.weight_grams).toBe(0)
  })

  it('buildData clamps quantity to 1..9999 and defaults bad input to 1', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => result.current.setName('Stake'))

    act(() => result.current.setQuantity('0'))
    expect(result.current.buildData()?.quantity).toBe(1)

    act(() => result.current.setQuantity('99999'))
    expect(result.current.buildData()?.quantity).toBe(9999)

    act(() => result.current.setQuantity('abc'))
    expect(result.current.buildData()?.quantity).toBe(1)

    act(() => result.current.setQuantity('6'))
    expect(result.current.buildData()?.quantity).toBe(6)
  })

  it('buildData carries the worn/consumable flags', () => {
    const { result } = renderHook(() => useQuickAddForm())
    act(() => {
      result.current.setName('Rain jacket')
      result.current.toggleWorn()
    })
    expect(result.current.buildData()).toEqual({
      name: 'Rain jacket',
      description: null,
      weight_grams: 0,
      quantity: 1,
      is_worn: true,
      is_consumable: false,
    })
  })
})
