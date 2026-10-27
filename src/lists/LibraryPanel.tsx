import { memo, useId, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import type { GearItem, Category } from '../lib/types'
import { groupByCategory } from '../lib/grouping'
import type { WeightUnit } from '../lib/weight'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_ROW,
  ROW_CONTROL_TARGET,
} from '../components/flat-table-styles'
import ItemWeightValue from '../components/ItemWeightValue'
import GearStatusBadge from '../components/gear/GearStatusBadge'
import PickerEmptyState from './PickerEmptyState'
import QuickAddItemModal from './QuickAddItemModal'
import { type AddItemData } from './use-quick-add-form'
import { useToggleSet } from '../lib/use-toggle-set'

type Props = {
  gearItems: GearItem[]
  categories: Category[]
  listItemGearIds: Set<string>
  /** The list-items query has not resolved, so `listItemGearIds` is empty
   *  because we do not KNOW what is on the list rather than because nothing
   *  is. Every row would render as not-yet-added and its tap would call
   *  onAdd - re-adding gear the list already holds. Both of this panel's jobs
   *  depend on that set, so the rows are replaced by a status line rather
   *  than shown in a state where they say the wrong thing. */
  membershipUnknown?: boolean
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  /** Creates a gear item AND this list's row for it in one atomic call.
   *
   *  The control lives in the picker rather than in a section footer because
   *  the picker means the same thing in both gear arrangements. A Pack
   *  section is a BAG, and CategoryGroup's footer add takes a category id -
   *  so an add there has no category to offer and would quietly file
   *  everything as Uncategorized while appearing to add "to this bag".
   *
   *  Optional: render paths with no list to add to pass none, and the
   *  control does not render. */
  onCreateNew?: (data: AddItemData, categoryId: string | null) => void
  /** Non-empty when creating is unavailable: the button is disabled and this
   *  becomes its accessible description.
   *
   *  This panel mounts OUTSIDE the page's detail loading/error gate - it
   *  needs only the gear query. Without this, a create could succeed while
   *  the document beside it says it could not load the list, leaving the user
   *  no way to confirm what happened. */
  createDisabledReason?: string
}

export default function LibraryPanel({ gearItems, categories, listItemGearIds, membershipUnknown = false, weightUnit, onAdd, onRemove, onCreateNew, createDisabledReason }: Props) {
  const [search, setSearch] = useState('')
  // Stable toggle: it goes straight to the memoized LibraryCategoryGroup as
  // onToggle, where a fresh closure would defeat React.memo.
  const { set: collapsed, toggle: toggleCollapse } = useToggleSet<string>()
  const [creating, setCreating] = useState(false)
  const searchId = useId()
  const createReasonId = useId()

  const q = search.trim().toLowerCase()
  const searchFiltered = useMemo(
    () =>
      q
        ? gearItems.filter(
            (g) =>
              g.name.toLowerCase().includes(q) ||
              (g.description?.toLowerCase().includes(q) ?? false),
          )
        : gearItems,
    [gearItems, q],
  )

  // Build groups ordered by category sort_order. sortedCats stays in its
  // own memo so the sort only reruns when `categories` changes — not on
  // every search keystroke (which churns the filtered set).
  const sortedCats = useMemo(
    () => categories.toSorted((a, b) => a.sortOrder - b.sortOrder),
    [categories],
  )

  // Empty categories filtered out (the panel hides cats with no matches
  // when the user is searching). Orphan-keyed items — a gear_item.category_id
  // pointing at a deleted category — are silently dropped, preserving the
  // previous inline behavior. In practice the gear_items.category_id ON
  // DELETE SET NULL FK makes this unreachable, but the helper documents
  // the policy explicitly. Result includes the uncategorized tail (if any
  // null-keyed items are present) appended after real-cat groups.
  const groups = useMemo(
    () =>
      groupByCategory(searchFiltered, sortedCats, (g) => g.categoryId, {
        keepEmpty: false,
        orphanPolicy: 'drop',
      }),
    [searchFiltered, sortedCats],
  )

  return (
    <div className="flex h-full flex-col">
      {/* Search-only picker header. Category chips were removed once the
          mobile bottom nav made the panel feel like clutter; users still
          have the per-category section collapse / item tap to navigate. */}
      <div className="p-3 border-b border-gray-200">
        <div className="relative">
          <label className="sr-only" htmlFor={searchId}>Search gear to add</label>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            id={searchId}
            type="search"
            placeholder="Search gear…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`w-full rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 ${FLAT_TABLE_BODY_TEXT} focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
        </div>

        {/* Creating, beneath searching, because searching is what this panel
            is mostly for - you reach for New item after a search comes up
            empty. */}
        {onCreateNew && (
          <>
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={Boolean(createDisabledReason)}
              aria-describedby={createDisabledReason ? createReasonId : undefined}
              className={`mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 ${FLAT_TABLE_BODY_TEXT} font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-white`}
            >
              <Plus size={14} /> New item
            </button>
            {createDisabledReason && (
              <p id={createReasonId} className={`mt-1 ${FLAT_TABLE_META_TEXT} text-gray-500`}>
                {createDisabledReason}
              </p>
            )}
          </>
        )}
      </div>

      {creating && onCreateNew && (
        <QuickAddItemModal
          // This caller has no section context, so the modal asks for the
          // category instead of silently filing the item Uncategorized.
          categories={categories}
          onSubmit={(data, categoryId) => {
            // Close FIRST, then hand off. This modal has no pending or
            // inline-error surface, so the create reports on the page it
            // returns to. (Closing first was also what once kept that toast
            // from expiring behind the dialog, before toasts rendered over
            // modals.)
            setCreating(false)
            onCreateNew(data, categoryId)
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {/* Category groups */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {membershipUnknown ? (
          <PickerEmptyState
            heading="Couldn't load this list's items."
            body="Adding gear is unavailable until it loads, so nothing gets added twice."
          />
        ) : groups.length === 0 ? (
          // Whether the user is searching for something not in their library
          // yet or they have no gear at all, the answer is the same - create
          // it. Where that happens depends on whether this panel can: with
          // onCreateNew the New item button above is the shortest path and
          // sending them to another page would be the exact trip this work
          // exists to remove. Without it, the Gear page still is. The mobile
          // bottom bar has a Gear destination so we don't restate that
          // navigation path here.
          <PickerEmptyState
            heading={searchFiltered.length === 0 && !q
              ? 'No gear yet.'
              : 'No matching gear.'}
            body={onCreateNew
              ? 'Use New item above to create it without leaving this list.'
              : 'Add it on the Gear page, then return here.'}
          />
        ) : (
          <>
            {groups.map(({ category, items }) => {
              // Synthetic uncategorized row uses the '__uncategorized__'
              // sentinel for the collapsed-state key and toggleKey, and
              // 'uncategorized' as the regionId tail — matches the
              // pre-refactor literals exactly.
              const key = category?.id ?? '__uncategorized__'
              return (
                <LibraryCategoryGroup
                  key={key}
                  name={category?.name ?? 'Uncategorized'}
                  items={items}
                  collapsed={collapsed.has(key)}
                  toggleKey={key}
                  onToggle={toggleCollapse}
                  listItemGearIds={listItemGearIds}
                  weightUnit={weightUnit}
                  onAdd={onAdd}
                  onRemove={onRemove}
                  regionId={`library-cat-${category?.id ?? 'uncategorized'}`}
                />
              )
            })}
          </>
        )}
      </div>

    </div>
  )
}


// Wrapped in React.memo so re-renders of LibraryPanel (driven by parent
// churn — drag ticks, NotesEditor keystrokes, list-items mutations) don't
// cascade into every gear-picker category. Memo's shallow compare works
// here because all props are reference-stable: `onToggle` is the parent's
// useCallback'd toggleCollapse, `toggleKey` is a primitive string, and
// listItemGearIds / onAdd / onRemove come from the page-level memoized
// sharedGroupProps. The earlier inline `onToggle={() => toggleCollapse(id)}`
// shape would have defeated the memo by minting a fresh closure every render.
const LibraryCategoryGroup = memo(function LibraryCategoryGroup({
  name,
  items,
  collapsed,
  toggleKey,
  onToggle,
  listItemGearIds,
  weightUnit,
  onAdd,
  onRemove,
  regionId,
}: {
  name: string
  items: GearItem[]
  collapsed: boolean
  toggleKey: string
  onToggle: (key: string) => void
  listItemGearIds: Set<string>
  weightUnit: WeightUnit
  onAdd: (item: GearItem) => void
  onRemove: (item: GearItem) => void
  regionId: string
}) {
  return (
    <div>
      {/* Category header - chevron is the only interactive collapse target.
          Static label area below has no hover state so the chevron is the
          obvious affordance. The header strip's bg-gray-50 stays as a
          visual section divider; it just isn't clickable as a whole. */}
      <div className={`${FLAT_TABLE_HEADER} ${FLAT_TABLE_HEADER_PADDING} w-full gap-1.5`}>
        <button
          type="button"
          onClick={() => onToggle(toggleKey)}
          aria-expanded={!collapsed}
          aria-controls={regionId}
          aria-label={collapsed ? `Expand ${name}` : `Collapse ${name}`}
          className={`${ROW_CONTROL_TARGET} text-gray-500 hover:text-gray-800 hover:bg-gray-200/60 shrink-0`}
        >
          {collapsed ? (
            <ChevronRight size={13} />
          ) : (
            <ChevronDown size={13} />
          )}
        </button>
        <span className={`flex-1 truncate ${FLAT_TABLE_HEADER_TITLE}`}>
          {name}
        </span>
      </div>

      {/* Items - pure picker rows. Activate to add/remove on the active list. */}
      {!collapsed && (
        <div id={regionId}>
          {items.map((item) => {
            const inList = listItemGearIds.has(item.id)
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => (inList ? onRemove(item) : onAdd(item))}
                title={inList ? 'Remove from list' : 'Add to list'}
                aria-label={inList ? `Remove ${item.name} from list` : `Add ${item.name} to list`}
                // Hover/focus background is uniform across in-list and
                // available rows. The in-list state is signalled by the
                // check mark and the dimmed name below, never by a rest
                // background: an earlier pass added a soft-blue rest tint
                // to in-list rows, and toggling that bg class on click
                // triggered a Chrome compositor paint deferral (data flow
                // correct, DOM correct, but the parent rounded table
                // surface + overflow-hidden ancestor chain on the sidebar
                // aside didn't invalidate its layer until another event
                // repainted). Do not reintroduce one.
                // Picker rows keep px-3 mobile inline (not the canonical
                // FLAT_TABLE_ROW_PADDING px-2 ramp): the picker drawer is
                // narrower than the main list, and the row has only name +
                // weight, so the uniform px-3 inset reads cleaner. py-0
                // lets the row's min-h-7 (28px) own the desktop height.
                className={`${FLAT_TABLE_ROW} w-full gap-2 px-3 py-0 text-left hover:bg-gray-50 focus:outline-none focus:bg-gray-100`}
              >
                {/* The in-list signal, and the PRIMARY one. A text-color step
                    (gray-900 -> gray-600) was carrying this alone and could
                    not: scanning a long library for what is already on the
                    list meant comparing two greys, and toggling a row gave
                    almost no visible confirmation that anything happened.
                    A mark that is present or absent is unambiguous at a
                    glance, and because it occupies a fixed-width slot on
                    EVERY row, the marks line up into a column you can scan
                    down instead of reading row by row.

                    A shape change rather than a rest-state background: the
                    soft-blue tint tried here before hit a Chrome compositor
                    paint deferral under this panel's rounded/overflow-hidden
                    ancestor chain (see the row-class comment history). Adding
                    and removing a child node is a layout change, which does
                    not defer that way - and the dimming below still rides
                    along as a second, independent cue. */}
                <span
                  aria-hidden="true"
                  className="shrink-0 w-4 inline-flex items-center justify-center"
                >
                  {inList && <Check size={14} className="text-blue-600" strokeWidth={3} />}
                </span>
                {/* Status badge — null-for-active means no leading
                    whitespace on the common case; non-active rows pick
                    up a subtle icon next to the name. */}
                <GearStatusBadge status={item.status} compact className="shrink-0" />
                {/* gray-600 for both muted states, where gray-500 is the muted
                    token everywhere else in the app. The row sets
                    focus:bg-gray-100, and gray-500 on gray-100 is 4.39:1 -
                    under the 4.5:1 floor by a hair, and a hair still fails.
                    gray-600 is 6.87:1 there. (The old gray-300 weight was
                    1.41:1: a picker row is operable in every state, so nothing
                    here is exempt as an inactive control.)

                    The consequence is that the weight cannot dim when an item is
                    already in the list - gray-600 is the contrast floor, so
                    there is no room below it. That leaves the name as the only
                    text that can carry the state, one step of grey, which is
                    why the check mark above is the primary signal and this is
                    the secondary one. */}
                <span
                  className={`flex-1 min-w-0 truncate ${FLAT_TABLE_BODY_TEXT} font-normal ${
                    inList ? 'text-gray-600' : 'text-gray-900'
                  }`}
                >
                  {item.name}
                </span>
                <span className={`shrink-0 ${FLAT_TABLE_NUMERIC_TEXT} text-gray-600`}>
                  <ItemWeightValue grams={item.weightGrams} unit={weightUnit} />
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
})
