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
