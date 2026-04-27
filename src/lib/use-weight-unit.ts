import { useState } from 'react'
import { getWeightUnit, setWeightUnit, type WeightUnit } from './weight'

// Reads the persisted unit on mount, exposes a toggle that flips between g
// and oz and writes through to localStorage so every page agrees on the unit.
export function useWeightUnit(): { weightUnit: WeightUnit; toggleWeightUnit: () => void } {
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(getWeightUnit)

  function toggleWeightUnit() {
    const next: WeightUnit = weightUnit === 'g' ? 'oz' : 'g'
    setWeightUnit(next)
    setWeightUnitState(next)
  }

  return { weightUnit, toggleWeightUnit }
}
