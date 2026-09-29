import { describe, it, expect } from 'vitest'
import { GEAR_STATUSES } from '../../shared/gear'
import {
  DEFAULT_GEAR_STATUS,
  GEAR_STATUS_MENU_OPTIONS,
  gearStatusVisual,
} from './gear-status'

// These tests pin the CLIENT half of the GearStatus contract - the badges and
// the dialog's menu options - against GEAR_STATUSES in shared/gear.ts, the one
// list of values. They cannot see the DB CHECK constraint in
// migrations/0000_baseline.sql that the list mirrors.

describe('DEFAULT_GEAR_STATUS', () => {
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
