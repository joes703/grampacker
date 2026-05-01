export type List = {
  id: string
  user_id: string
  name: string
  description: string | null
  slug: string
  is_shared: boolean
  sort_order: number
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
  gear_item: Pick<GearItem, 'id' | 'name' | 'description' | 'weight_grams' | 'category_id'>
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
  sort_order: number
  created_at: string
  updated_at: string
}

// Narrower response shapes for public read paths (/r/<slug>). Fewer columns
// than the authenticated equivalents — see SECURITY.md "Public read paths"
// for the allowlist rationale. SharePage maps these to the full types at the
// boundary before passing items/categories to shared components.

export type PublicList = Pick<List, 'id' | 'name' | 'description'>

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
