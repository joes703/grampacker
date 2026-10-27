import type { ComponentProps } from 'react'
import { Pencil } from 'lucide-react'
import type { Category, List, ListItemWithGear } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import type { StableListItemGroup } from '../lib/use-grouped-list-items'
import type { WeightBreakdown } from '../lib/weight-breakdown'
import type { FoodItemResponse } from '../../shared/food'
import AddCategoryControl from './AddCategoryControl'
import CategoryGroup, { type SectionGroupProps } from './CategoryGroup'
import CategorySections from './CategorySections'
import EmptyListCell from './EmptyListCell'
import ListDndArea from './ListDndArea'
import NotesEditor from './NotesEditor'
import PanelCard from './PanelCard'
import WeightSummary from './WeightSummary'
import type { AddItemData } from './use-quick-add-form'
import type { useListDnd } from './use-list-dnd'

const EMPTY_LIST_ITEMS: ListItemWithGear[] = []

type Props = {
  list: List
  notes: {
    editing: boolean
    onEditingChange: (editing: boolean) => void
    saving: boolean
    onSave: ComponentProps<typeof NotesEditor>['onSave']
  }
  listItems: ListItemWithGear[]
  categories: Category[]
  grouped: StableListItemGroup[]
  breakdown: WeightBreakdown
  food: FoodItemResponse[]
  foodGrams: number
  // Categories created from this page this session (see the page's state).
  starterCategories: Category[]
  onCreateCategory: (name: string) => Promise<Category>
  onCategoryCreated: (category: Category) => void
  onAddItem: (categoryId: string | null, data: AddItemData) => void
  onOpenDrawer: () => void
  groupProps: SectionGroupProps
  dnd: ReturnType<typeof useListDnd>
  listItemsById: ReadonlyMap<string, ListItemWithGear>
  weightUnit: WeightUnit
  isBelowLg: boolean
}

// The List view's document: notes and weight, the category sections, and
// the list's food.
export default function ListDocument({
  list,
  notes,
  listItems,
  categories,
  grouped,
  breakdown,
  food,
  foodGrams,
  starterCategories,
  onCreateCategory,
  onCategoryCreated,
  onAddItem,
  onOpenDrawer,
  groupProps,
  dnd,
  listItemsById,
  weightUnit,
  isBelowLg,
}: Props) {
  // Mirrors WeightSummary's own render guard.
  const showWeightSummary = listItems.length > 0 || breakdown.totalPackGrams > 0
  // Starter sections: categories created here that have no items yet
  // (grouped hides empty categories). Prefer the cached row (it follows a
  // rename on /gear); the stored object covers the gap before the refetch.
  const starters = starterCategories
    .filter((starter) => !grouped.some((group) => group.group?.id === starter.id))
    .map((starter) => categories.find((category) => category.id === starter.id) ?? starter)

  return (
    <>
      {/* Notes and Weight summary, side by side on desktop with Notes in the
          wider column. Two columns exactly when WeightSummary renders
          something. */}
      <div className={`print:hidden grid gap-4 ${showWeightSummary ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
        <PanelCard
          title="Notes"
          headerAction={
            !notes.editing && (
              // Waits for a save the user canceled mid-flight: a second save
              // would take over its callbacks, and its failure would go
              // unreported.
              <button
                type="button"
                onClick={() => notes.onEditingChange(true)}
                disabled={notes.saving}
                aria-label="Edit notes"
                title="Edit notes"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
              >
                <Pencil size={13} />
              </button>
            )
          }
        >
          <NotesEditor
            key={list.id}
            initial={list.description ?? ''}
            onSave={notes.onSave}
            editing={notes.editing}
            onEditingChange={notes.onEditingChange}
          />
        </PanelCard>
        <WeightSummary items={listItems} categories={categories} breakdown={breakdown} />
      </div>

      <div className="flex flex-col gap-3">
        {/* A starter category counts as content: its section renders so the
            user can type the first item in. */}
        {listItems.length === 0 && starterCategories.length === 0 ? (
          <EmptyListCell onMobileAdd={onOpenDrawer} />
        ) : (
          <ListDndArea
            dnd={dnd}
            groupingKind="category"
            listItemsById={listItemsById}
            weightUnit={weightUnit}
            isBelowLg={isBelowLg}
          >
            <CategorySections
              grouped={grouped}
              groupProps={groupProps}
              reorderPending={dnd.anyItemReorderPending}
              breakdown={breakdown}
              onAddItem={onAddItem}
            />
            {/* Rendered with the add-item row already open: the point of
                making a category is typing an item into it next. */}
            {starters.map((category) => (
              <CategoryGroup
                key={`starter-${category.id}`}
                name={category.name}
                categoryId={category.id}
                items={EMPTY_LIST_ITEMS}
                {...groupProps}
                reorderPending={dnd.anyItemReorderPending}
                onAddItem={onAddItem}
                startAdding
              />
            ))}
          </ListDndArea>
        )}
        {/* In-list category creation. Category ORDER is still authored on
            /gear. */}
        <AddCategoryControl onCreate={onCreateCategory} onCreated={onCategoryCreated} />
      </div>

      {/* The list's food, as its own trailing section of rows. Food you carry
          is part of the pack, so List, Pack and the share all show the rows.
          Outside the empty-gear branch above: a list with food and no gear
          yet is a real, usable list. */}
      {food.length > 0 && (
        <CategoryGroup
          name="Food"
          items={EMPTY_LIST_ITEMS}
          regionKey="food"
          foodRows={food}
          weightUnit={weightUnit}
          isBelowLg={isBelowLg}
          // CONSUMABLE, not the bare subtotal. `subtotalGrams` is the Worn
          // section's channel and CategoryFooterWeights labels it "Worn".
          // Food is consumable by definition, the same bucket its grams
          // already land in upstream.
          consumableSubtotalGrams={foodGrams}
          // No grip, kebab or Edit link: the rows are a read-out, authored in
          // the Food view. Both control boxes are reserved empty so this
          // table's cells and footer line up with the gear rows above.
          reserveControlColumns
        />
      )}
    </>
  )
}
