// UI-facing row types. Unlike the old repo (where this file hand-declared
// snake_case Supabase row shapes), these ARE the shared API DTOs - one
// source of truth, camelCase end-to-end. The aliases keep the transplanted
// components' import path stable. Grows per transplanted slice.
export type { Category } from './queries/categories'
export type { GearItem } from './queries/gear'
export type { GearStatus } from '../../shared/gear'
export type { List } from './queries/lists'
export type { ListItemWithGear } from './queries/list-items'
