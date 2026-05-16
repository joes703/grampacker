import type { GearStatus } from './gear-status'

export type List = {
  id: string
  user_id: string
  name: string
  description: string | null
  slug: string
  is_shared: boolean
  sort_order: number
  // Per-list organization toggle. When true, is_worn list_items are pulled
  // out of their categories and rendered in a trailing "Worn" section in
  // both normal and pack mode, and on the public /r/<slug> share view.
  // Default false; persisted in public.lists.group_worn.
  group_worn: boolean
  created_at: string
  updated_at: string
}

export type ListItem = {
  id: string
  list_id: string
  user_id: string
  gear_item_id: string
  quantity: number
  is_worn: boolean
  is_consumable: boolean
  is_packed: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

// ListItem joined with its source GearItem. Always present: gear_item_id is
// NOT NULL with ON DELETE CASCADE, so a list_item cannot outlive its gear.
export type ListItemWithGear = ListItem & {
  gear_item: Pick<
    GearItem,
    'id' | 'name' | 'description' | 'weight_grams' | 'category_id' | 'status'
  >
}

export type Category = {
  id: string
  user_id: string
  name: string
  sort_order: number
  is_default: boolean
  created_at: string
}

export type GearItem = {
  id: string
  user_id: string
  category_id: string | null
  name: string
  description: string | null
  weight_grams: number
  // Display-only inventory metadata. Nullable because many items have
  // unknown values (gifts, old gear). Not part of any pack-weight or
  // trip calculation, and not surfaced in list views or public shares —
  // see PublicGearItem and ListItemWithGear.gear_item, both of which
  // intentionally omit these. cost is USD; purchase_date is ISO YYYY-MM-DD.
  cost: number | null
  purchase_date: string | null
  // Advisory inventory metadata. NOT NULL with default 'active' in the DB
  // (migration 20260516000000). Surfaced in private views (gear library,
  // gear picker, private list rows) but explicitly excluded from public
  // share projections — see PublicGearItem below. Type pinned to GearStatus
  // so the union and the CHECK constraint stay in lockstep.
  status: GearStatus
  sort_order: number
  created_at: string
  updated_at: string
}

// Narrower response shapes for public read paths (/r/<slug>). Fewer columns
// than the authenticated equivalents — see SECURITY.md "Public read paths"
// for the allowlist rationale. SharePage maps these to the full types at the
// boundary before passing items/categories to shared components.

export type PublicList = Pick<List, 'id' | 'name' | 'description' | 'group_worn'>

export type PublicGearItem = Pick<
  GearItem,
  'id' | 'name' | 'description' | 'weight_grams' | 'category_id'
>

export type PublicListItem = Pick<
  ListItem,
  'id' | 'gear_item_id' | 'quantity' | 'is_worn' | 'is_consumable' | 'sort_order'
> & {
  gear_item: PublicGearItem
}

export type PublicCategory = Pick<Category, 'id' | 'name' | 'sort_order'>
