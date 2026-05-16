import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GEAR_STATUS,
  GEAR_STATUSES,
  coerceGearStatus,
  gearStatusVisual,
  isGearStatus,
} from './gear-status'

// These tests pin the GearStatus contract that the DB CHECK constraint
// in migration 20260516000000 and the GearItemDialog select rely on.
// Adding a new status requires updating both ends; this file catches
// drift between them.

describe('GEAR_STATUSES', () => {
  it('lists exactly the three values the DB CHECK constraint allows', () => {
    expect([...GEAR_STATUSES].sort()).toEqual(['active', 'loaned_out', 'needs_repair'])
  })

  it('treats active as the default', () => {
    expect(DEFAULT_GEAR_STATUS).toBe('active')
  })
})

describe('isGearStatus', () => {
  it('accepts each canonical value', () => {
    for (const s of GEAR_STATUSES) {
      expect(isGearStatus(s)).toBe(true)
    }
  })

  it('rejects unknown strings, casing variants, and non-strings', () => {
    expect(isGearStatus('archived')).toBe(false)
    expect(isGearStatus('Active')).toBe(false)
    expect(isGearStatus('')).toBe(false)
    expect(isGearStatus(null)).toBe(false)
    expect(isGearStatus(undefined)).toBe(false)
    expect(isGearStatus(0)).toBe(false)
  })
})

describe('coerceGearStatus', () => {
  it('returns the value when valid', () => {
    expect(coerceGearStatus('needs_repair')).toBe('needs_repair')
    expect(coerceGearStatus('loaned_out')).toBe('loaned_out')
  })

  it('falls back to the default for missing or unrecognized inputs', () => {
    expect(coerceGearStatus(undefined)).toBe(DEFAULT_GEAR_STATUS)
    expect(coerceGearStatus('')).toBe(DEFAULT_GEAR_STATUS)
    expect(coerceGearStatus('archived')).toBe(DEFAULT_GEAR_STATUS)
    expect(coerceGearStatus(null)).toBe(DEFAULT_GEAR_STATUS)
  })
})

describe('gearStatusVisual', () => {
  it('returns null for the default status so no badge renders', () => {
    expect(gearStatusVisual('active')).toBeNull()
  })

  it('returns a label, icon, and tailwind classes for each non-default status', () => {
    for (const s of ['needs_repair', 'loaned_out'] as const) {
      const v = gearStatusVisual(s)
      expect(v).not.toBeNull()
      expect(typeof v!.label).toBe('string')
      expect(v!.label.length).toBeGreaterThan(0)
      expect(typeof v!.icon).toBe('object')
      expect(typeof v!.badgeClass).toBe('string')
      expect(v!.badgeClass.length).toBeGreaterThan(0)
    }
  })

  it('uses the user-facing labels from the spec', () => {
    expect(gearStatusVisual('needs_repair')?.label).toBe('Needs repair')
    expect(gearStatusVisual('loaned_out')?.label).toBe('Loaned out')
  })
})
