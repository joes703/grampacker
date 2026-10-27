import type { StableListItemGroup } from '../lib/use-grouped-list-items'
import {
  baseGramsForCategory,
  consumableGramsForCategory,
  wornGramsForCategory,
  type WeightBreakdown,
} from '../lib/weight-breakdown'
import CategoryTable from './CategoryTable'
import type { SharedSectionProps } from './section-parts'
import type { AddItemData } from './use-quick-add-form'

type Props = {
  grouped: StableListItemGroup[]
  groupProps: SharedSectionProps
  reorderPending: boolean
  breakdown: WeightBreakdown
  onAddItem: (categoryId: string | null, data: AddItemData) => void
}

// The List view's category sections, in the categories' global sortOrder,
// with items in their own order. The group with no category is
// "Uncategorized".
export default function CategorySections({
  grouped,
  groupProps,
  reorderPending,
  breakdown,
  onAddItem,
}: Props) {
  return grouped.map((group) => {
    const categoryId = group.group?.id ?? null
    return (
      <CategoryTable
        key={categoryId ?? '__uncategorized__'}
        name={group.group?.name ?? 'Uncategorized'}
        categoryId={categoryId}
        items={group.items}
        {...groupProps}
        reorderPending={reorderPending}
        baseSubtotalGrams={baseGramsForCategory(breakdown, categoryId)}
        consumableSubtotalGrams={consumableGramsForCategory(breakdown, categoryId)}
        wornSubtotalGrams={wornGramsForCategory(breakdown, categoryId)}
        onAddItem={onAddItem}
      />
    )
  })
}
