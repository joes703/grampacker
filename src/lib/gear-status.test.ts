import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GEAR_STATUS,
  GEAR_STATUS_MENU_OPTIONS,
  GEAR_STATUSES,
  gearStatusVisual,
} from './gear-status'

// These tests pin the GearStatus contract that the DB CHECK constraint
// in migration 20260516000000 and the GearItemDialog select rely on.
// Adding a new status requires updating both ends; this file catches
// drift between them.

describe('GEAR_STATUSES', () => {
  it('lists exactly the values the DB CHECK constraint allows', () => {
    expect(GEAR_STATUSES.toSorted()).toEqual([
      'active',
      'loaned_out',
      'need_to_buy',
      'needs_repair',
    ])
  })

  it('treats active as the default', () => {
    expect(DEFAULT_GEAR_STATUS).toBe('active')
  })
})


describe('gearStatusVisual', () => {
  it('returns null for the default status so no badge renders', () => {
    expect(gearStatusVisual('active')).toBeNull()
  })

  it('returns a label, icon, and tailwind classes for each non-default status', () => {
    for (const s of ['needs_repair', 'loaned_out', 'need_to_buy'] as const) {
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
    expect(gearStatusVisual('need_to_buy')?.label).toBe('Need to buy')
  })

  it('uses the unavailable badge color for statuses where the item is not on hand', () => {
    expect(gearStatusVisual('need_to_buy')?.badgeClass).toBe(
      gearStatusVisual('loaned_out')?.badgeClass,
    )
  })
})

describe('GEAR_STATUS_MENU_OPTIONS', () => {
  it('lists all statuses in canonical order with labels and icons', () => {
    expect(GEAR_STATUS_MENU_OPTIONS).toHaveLength(4)
    expect(GEAR_STATUS_MENU_OPTIONS.map((o) => o.status)).toEqual([
      'active',
      'needs_repair',
      'loaned_out',
      'need_to_buy',
    ])
    expect(GEAR_STATUS_MENU_OPTIONS.map((o) => o.label)).toEqual([
      'Active',
      'Needs repair',
      'Loaned out',
      'Need to buy',
    ])
    for (const opt of GEAR_STATUS_MENU_OPTIONS) {
      // icon is a lucide component (forwarded ref → function/object).
      expect(opt.icon).toBeTruthy()
    }
  })

  it('covers every value in GEAR_STATUSES (no menu/DB drift)', () => {
    expect(GEAR_STATUS_MENU_OPTIONS.map((o) => o.status).toSorted()).toEqual(
      GEAR_STATUSES.toSorted(),
    )
  })
})
