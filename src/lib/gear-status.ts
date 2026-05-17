import { CircleCheck, PackageX, Wrench, type LucideIcon } from 'lucide-react'
import {
  LOANED_OUT_BADGE_CLASS,
  NEEDS_REPAIR_BADGE_CLASS,
} from './row-indicator-styles'

// Inventory-level advisory metadata on gear_items.status. Values are pinned
// to the DB CHECK constraint in migration 20260516000000 — keep this list
// and the constraint in lockstep. 'active' is the default and renders no
// visible treatment; the other two surface a small badge in private views
// only (gear library, gear picker, private list rows) and are explicitly
// excluded from public share projections.

export const GEAR_STATUSES = ['active', 'needs_repair', 'loaned_out'] as const

export type GearStatus = (typeof GEAR_STATUSES)[number]

export const DEFAULT_GEAR_STATUS: GearStatus = 'active'

export function isGearStatus(value: unknown): value is GearStatus {
  return typeof value === 'string' && (GEAR_STATUSES as readonly string[]).includes(value)
}

// Coerce an arbitrary value (CSV cell, network payload) to a GearStatus,
// returning the default when the input is missing or unrecognized. Callers
// that need to distinguish "missing" from "invalid" should use isGearStatus
// directly.
export function coerceGearStatus(value: unknown): GearStatus {
  return isGearStatus(value) ? value : DEFAULT_GEAR_STATUS
}

type GearStatusVisual = {
  label: string
  icon: LucideIcon
  // Tailwind utility classes applied to the badge container. Kept as a
  // single string so consumers don't have to know which slot is which.
  badgeClass: string
}

const VISUALS: Record<Exclude<GearStatus, 'active'>, GearStatusVisual> = {
  needs_repair: {
    label: 'Needs repair',
    icon: Wrench,
    badgeClass: NEEDS_REPAIR_BADGE_CLASS,
  },
  loaned_out: {
    label: 'Loaned out',
    icon: PackageX,
    badgeClass: LOANED_OUT_BADGE_CLASS,
  },
}

// Returns the visual descriptor for a non-default status, or null when the
// status is 'active' (no badge should be rendered). Centralizing the
// null-for-active decision here keeps every call site honest — there is
// no path where 'active' produces a badge.
export function gearStatusVisual(status: GearStatus): GearStatusVisual | null {
  return status === 'active' ? null : VISUALS[status]
}

// Menu-row metadata: every status (including 'active') gets a label and
// icon for the row-kebab quick-set menu. Distinct from gearStatusVisual,
// which intentionally returns null for 'active' so badges stay quiet.
// Ordered ['active', 'needs_repair', 'loaned_out'] to match GEAR_STATUSES
// — single source of truth for menu rendering order.
export type GearStatusMenuOption = {
  status: GearStatus
  label: string
  icon: LucideIcon
}

export const GEAR_STATUS_MENU_OPTIONS: readonly GearStatusMenuOption[] = [
  { status: 'active', label: 'Active', icon: CircleCheck },
  { status: 'needs_repair', label: 'Needs repair', icon: Wrench },
  { status: 'loaned_out', label: 'Loaned out', icon: PackageX },
] as const
