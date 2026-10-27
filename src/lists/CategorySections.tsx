import type { ReactNode } from 'react'
import type { StableListItemGroup } from '../lib/use-grouped-list-items'
import type { ListItemWithGear } from '../lib/types'
import {
  baseGramsForCategory,
  consumableGramsForCategory,
  wornGramsForCategory,
  type WeightBreakdown,
} from '../lib/weight-breakdown'
import CategoryGroup, { type SectionGroupProps } from './CategoryGroup'
import type { AddItemData } from './use-quick-add-form'

type Props = {
  grouped: StableListItemGroup[]
  groupProps: SectionGroupProps
  renderRowAction?: (item: ListItemWithGear) => ReactNode
  reorderPending: boolean
  breakdown: WeightBreakdown
  onAddItem: (categoryId: string | null, data: AddItemData) => void
}

// One section per category group, in the categories' global sortOrder, with
// items in their own order. The group with no category is "Uncategorized".
// Categories are not reorderable here (category order is authored on /gear);
// each section still reorders its own items.
export default function CategorySections({
  grouped,
  groupProps,
  renderRowAction,
  reorderPending,
  breakdown,
  onAddItem,
}: Props) {
  return grouped.map((group) => {
    const categoryId = group.group?.id ?? null
    return (
      <CategoryGroup
        key={categoryId ?? '__uncategorized__'}
        name={group.group?.name ?? 'Uncategorized'}
        categoryId={categoryId}
        items={group.items}
        {...groupProps}
        renderRowAction={renderRowAction}
        reorderPending={reorderPending}
        baseSubtotalGrams={baseGramsForCategory(breakdown, categoryId)}
        consumableSubtotalGrams={consumableGramsForCategory(breakdown, categoryId)}
        wornSubtotalGrams={wornGramsForCategory(breakdown, categoryId)}
        onAddItem={onAddItem}
      />
    )
  })
}
