import { memo, useState, useRef, useEffect } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, Check, X } from 'lucide-react'
import type { Category, GearItem } from '../lib/types'
import type { WeightUnit } from '../lib/weight'
import { makeDnDId } from '../lib/dnd-ids'
import { useSortableRow, type SortableHandleProps } from '../lib/use-sortable-row'
import { SortableGearItemRow } from './GearItemRow'
import KebabMenu from '../components/KebabMenu'
import RowIconButton from '../components/RowIconButton'
import { RowMenuItem, RowMenuSeparator } from '../components/RowMenuItem'
import { useCommitOnce } from '../lib/use-commit-once'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_SURFACE,
  INLINE_EDIT_FOCUS_RING,
  ROW_LEADING_CONTROL_TARGET,
} from '../components/flat-table-styles'

type CategorySectionProps = {
  category: Category | null // null = Uncategorized
  items: GearItem[]
  weightUnit: WeightUnit
  isBelowLg: boolean
  collapsed: boolean
  // Receives the collapse key so the page can pass ONE stable toggle identity
  // to every section (the section binds its own key). Keeps memo real.
  onToggleCollapse: (key: string) => void
  selectMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  onInlineSave: (id: string, patch: Partial<Pick<GearItem, 'name' | 'description' | 'weightGrams'>>) => void
  onEditItem: (item: GearItem) => void
  onDeleteItem: (item: GearItem) => void
  onSetItemStatus: (id: string, status: GearItem['status']) => void
  onRenameCategory: (id: string, name: string) => void
  onDeleteCategory: (category: Category) => void
  /** Threaded to each SortableGearItemRow as `reorderPending` so the gear-
   *  item drag handles disable while the gear-item reorder mutation is in
   *  flight. Distinct from the category-level reorderPending on
   *  SortableCategorySection (which gates the section's own drag). */
  itemReorderPending?: boolean
}

function CategorySectionInner(
  props: CategorySectionProps & {
    dragHandleProps?: SortableHandleProps
  },
) {
  const {
    category,
    items,
    weightUnit,
    isBelowLg,
    collapsed,
    onToggleCollapse,
    selectMode,
    selectedIds,
    onToggleSelect,
    onInlineSave,
    onEditItem,
    onDeleteItem,
    onSetItemStatus,
    onRenameCategory,
    onDeleteCategory,
    itemReorderPending,
    dragHandleProps,
  } = props

  const [renaming, setRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState(category?.name ?? '')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const commitOnce = useCommitOnce()

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus()
  }, [renaming])

  function commitRename() {
    const trimmed = renameDraft.trim()
    if (trimmed && category && trimmed !== category.name) {
      onRenameCategory(category.id, trimmed)
    }
    setRenaming(false)
  }

  const isUncategorized = category === null
  const name = category?.name ?? 'Uncategorized'
  // Stable id for the collapsible items region so the chevron button can
  // announce aria-controls.
  const regionId = `gear-cat-region-${category?.id ?? 'uncategorized'}`
  // Matches the page's collapse-Set key derivation (group.category?.id ??
  // '__uncategorized__'); the section binds it onto the stable onToggleCollapse.
  const collapseKey = category?.id ?? '__uncategorized__'

  return (
    // Each category renders as its own flat-table card (FLAT_TABLE_SURFACE);
    // GearLibraryPage composes the gaps between cards.
    <div className={FLAT_TABLE_SURFACE}>
      {/* Category header — flat section divider (bg-gray-50 + bottom border),
          matching the gear-picker reference grammar. */}
      <div className={`${FLAT_TABLE_HEADER} gap-1.5 ${FLAT_TABLE_HEADER_PADDING} ${
        // Canonical gap-1.5 + px-3, matching GearItemRow's own gap and
        // padding. This header previously used a tighter gap-1 + px-2 to make
        // room for an extra LEADING drag-handle column; that grip now sits
        // after the title, so the reason for the tighter variant is gone and
        // the header can share the row geometry exactly. Matching both values
        // is what puts the chevron in the same column as each row's drag
        // handle and the category title in the same column as the item names
        // - verified in a browser, not derived on paper.
        //
        // Collapsed: header is the card's only child, so its divider border
        // would double with the card's bottom border. Drop it.
        collapsed ? 'border-b-0' : ''
      }`}>
        {/* The category grip used to lead this header, ahead of the chevron.
            That gave the header TWO leading controls where each GearItemRow
            has one (its own drag handle), so the category title started 30px
            right of the item names beneath it - measured, not inferred. The
            chevron is the control that mirrors the row's slot, so it leads
            now and the section-only grip moved after the title. See
            docs/ui-density.md "Reserved space". */}

        {/* Collapse toggle - sized for touch on mobile (40x40, the minimum
            comfortable target on phone hardware) and tightened on desktop
            where mouse precision is higher. The chevron is the only
            collapse affordance; the name button next to it triggers
            rename, not collapse, so the two intents stay separate.
            ROW_LEADING_CONTROL_TARGET, not ROW_CONTROL_TARGET: this box has
            to stay the same width as GearItemRow's grip or the alignment
            documented above stops holding. Glyph is 14px to match the
            narrower desktop box (and CategoryGroup's chevron). */}
        <button
          onClick={() => onToggleCollapse(collapseKey)}
          aria-expanded={!collapsed}
          aria-controls={regionId}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          className={`${ROW_LEADING_CONTROL_TARGET} text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0`}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>

        {/* Category name / rename input */}
        {renaming ? (
          <input
            ref={renameInputRef}
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => commitOnce(commitRename)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitOnce(commitRename)
              if (e.key === 'Escape') {
                commitOnce(() => {
                  setRenameDraft(category?.name ?? '')
                  setRenaming(false)
                })
              }
            }}
            className={`flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 ${FLAT_TABLE_BODY_TEXT} font-medium ${INLINE_EDIT_FOCUS_RING}`}
          />
        ) : (
          category && !selectMode ? (
            <button
              type="button"
              onClick={() => {
                setRenameDraft(category.name)
                setRenaming(true)
              }}
              title="Rename category"
              // -ml-1 cancels this button's own px-1 so the TEXT starts on the
              // shared content column (where item names start), not 4px right
              // of it. The padding itself stays: it is what gives the rename
              // hover background room to breathe around the label. The
              // non-interactive title variant below needs no such offset
              // because it carries no padding.
              className={`flex-1 min-w-0 -ml-1 rounded px-1 py-0.5 text-left ${FLAT_TABLE_HEADER_TITLE} hover:bg-gray-200`}
            >
              <span className="truncate">{name}</span>
            </button>
          ) : (
            <span className={`flex-1 select-none ${FLAT_TABLE_HEADER_TITLE}`}>
              {name}
            </span>
          )
        )}

        {/* Category drag handle. Deliberately a sibling BEFORE the trailing
            cluster, not a child of it: that cluster's Price/Purchased/Weight/
            kebab columns are width-matched to GearItemRow's right-side
            columns, so adding a control inside it would shift every label off
            its row column. Sitting here, it takes its width from the
            flex-1 min-w-0 title instead, which only truncates a long category
            name slightly earlier and leaves every column coordinate intact.
            Hidden while renaming: the rename input needs that flexible space,
            and dragging a section mid-rename is not a real interaction. */}
        {!isUncategorized && dragHandleProps && !renaming && (
          <RowIconButton
            {...dragHandleProps}
            variant="dragHandle"
            touchSafe
            ariaLabel={`Reorder ${name}`}
            icon={<GripVertical size={16} />}
          />
        )}

        {/* Header actions — hidden in select mode */}
        {!selectMode && !renaming && (
          <div className="flex items-center gap-1.5 ml-auto">
            {/* Desktop column labels — widths and gap mirror GearItemRow's
               right-side columns (w-20 cost, w-24 purchase date, w-24
               weight, w-6 kebab) so labels sit directly above row values.
               No horizontal nudge is needed any more: the header now uses the
               row's own px-3 + gap-1.5, so the two rails share coordinates
               outright instead of compensating for a 4px difference.
               lg:contents
               flattens the labels into the parent flex on desktop so the
               parent's gap-1.5 applies between every column. Suppressed
               on mobile, when the category is collapsed, on empty
               categories, and in select mode (the parent !selectMode
               gate handles that — the row reshapes there: checkbox added,
               kebab removed, so labels would no longer match columns). */}
            {items.length > 0 && !collapsed && (
              <div aria-hidden="true" className="hidden lg:contents">
                <span className={`shrink-0 w-20 text-right ${FLAT_TABLE_EYEBROW}`}>Price</span>
                <span className={`shrink-0 w-24 text-right ${FLAT_TABLE_EYEBROW}`}>Purchased</span>
                <span className={`shrink-0 w-24 text-right ${FLAT_TABLE_EYEBROW}`}>Weight</span>
                {/* Uncategorized has no category-level kebab in the header,
                   but item rows still render a per-row kebab in non-select
                   mode. Without this spacer, the labels above would slide
                   1.875rem (w-6 + gap-1.5) right of the row column edges. */}
                {!category && <span className="shrink-0 w-6" />}
              </div>
            )}
            {category && (
              <CategoryKebab
                onRename={() => {
                  setRenameDraft(category.name)
                  setRenaming(true)
                }}
                onDelete={() => onDeleteCategory(category)}
              />
            )}
          </div>
        )}

        {/* Both buttons keep focus in the input on press. Otherwise the press
            blurs it, the blur commits the draft, and these unmount before
            the click lands - so Cancel would save the rename. */}
        {renaming && (
          <div className="flex items-center gap-0.5 ml-auto">
            <RowIconButton
              variant="success"
              touchSafe
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitRename}
              title="Confirm rename"
              ariaLabel="Confirm rename"
              icon={<Check size={14} />}
            />
            <RowIconButton
              touchSafe
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setRenameDraft(category?.name ?? '')
                setRenaming(false)
              }}
              title="Cancel rename"
              ariaLabel="Cancel rename"
              icon={<X size={14} />}
            />
          </div>
        )}
      </div>

      {/* Items */}
      {!collapsed && (
        <div id={regionId}>
          {items.length === 0 ? (
            <p className={`py-2 px-3 ${FLAT_TABLE_BODY_TEXT} text-gray-500 italic`}>No items</p>
          ) : (
            // Per-category SortableContext — items reorder within their own
            // category only. Each row's useSortable resolves to this list.
            <SortableContext items={items.map((i) => makeDnDId('gear-item', i.id))} strategy={verticalListSortingStrategy}>
              {items.map((item) => (
                // Forward the page's stable callback identities straight through
                // (the row binds its own item/id internally). No per-row closures
                // here, so memo(SortableGearItemRow) holds: only `selected`
                // changes for the one toggled row on a selection change.
                <SortableGearItemRow
                  key={item.id}
                  item={item}
                  weightUnit={weightUnit}
                  isBelowLg={isBelowLg}
                  selectMode={selectMode}
                  reorderPending={itemReorderPending}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={onToggleSelect}
                  onInlineSave={onInlineSave}
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                  onSetStatus={onSetItemStatus}
                />
              ))}
            </SortableContext>
          )}
        </div>
      )}
    </div>
  )
}

function CategoryKebab({
  onRename,
  onDelete,
}: {
  onRename: () => void
  onDelete: () => void
}) {
  return (
    <KebabMenu touchSafe ariaLabel="Category options" menuLabel="Category actions">
      {({ close }) => (
        <>
          <RowMenuItem icon={<Pencil size={13} />} onClick={() => { close(); onRename() }}>
            Rename
          </RowMenuItem>
          <RowMenuSeparator />
          <RowMenuItem icon={<Trash2 size={13} />} onClick={() => { close(); onDelete() }} tone="danger">
            Delete category
          </RowMenuItem>
        </>
      )}
    </KebabMenu>
  )
}

// Sortable wrapper used for real categories (not Uncategorized). The `id`
// prop is the bare category uuid; we wrap it with makeDnDId here so callers
// don't have to know about the typed-id convention. `reorderPending`
// disables the handle while a previous reorder mutation is still in flight,
// preventing the rollback-clobber race when two reorders overlap.
// memo'd so an unrelated page-state churn (typing a new-category name, opening
// a dialog, toggling the weight unit) skips the whole section subtree - the page
// passes stable callback identities and a stable `items` reference (groups are
// useMemo'd), so the only props that change are the ones that should re-render a
// section: this category's own `collapsed`/`selectedIds`/`selectMode`/`items`.
// useSortable still re-renders this on category drag regardless of memo.
export const SortableCategorySection = memo(function SortableCategorySection(
  props: CategorySectionProps & { id: string; reorderPending?: boolean },
) {
  const { id, reorderPending, ...rest } = props
  const { outerRef, outerStyle, handleProps } = useSortableRow({
    kind: 'category',
    id,
    disabled: reorderPending,
  })

  return (
    <div ref={outerRef} style={outerStyle}>
      <CategorySectionInner {...rest} dragHandleProps={handleProps} />
    </div>
  )
})

// Non-sortable version for Uncategorized. memo'd for the same reason as the
// sortable variant: skip the Uncategorized subtree on unrelated page churn.
export const StaticCategorySection = memo(function StaticCategorySection(props: CategorySectionProps) {
  return <CategorySectionInner {...props} />
})
