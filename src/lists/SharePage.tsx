import { Suspense, lazy, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { queries } from '../lib/queries/options'
import { groupListItemsByCategory } from '../lib/grouping'
import type { Category, ListItemWithGear } from '../lib/types'
import {
  getShareWeightUnit,
  setShareWeightUnit,
  type WeightUnit,
} from '../lib/weight'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useDocumentTitle } from '../lib/use-document-title'
import {
  baseGramsForCategory,
  computeListWeightBreakdown,
  consumableGramsForCategory,
  foodGramsFor,
  wornGramsForCategory,
} from '../lib/weight-breakdown'
import WeightTable from './WeightTable'
import PanelCard from './PanelCard'
import CategoryGroup from './CategoryGroup'
import DraftBanner from './DraftBanner'
import { UnitSegmentedControlView } from '../components/UnitSegmentedControl'
import {
  FLAT_TABLE_SURFACE,
  PANEL_EMPTY_TEXT,
} from '../components/flat-table-styles'

// Notes are rendered as Markdown on the public share view (typing markdown
// in the authed NotesEditor textarea is the only authoring path). Lazy so
// the react-markdown + remark-gfm chunk doesn't land in the share-view
// cold-load when the list has no description.
const MarkdownContent = lazy(() => import('../components/MarkdownContent'))

// Module-level constant: the Food section holds no gear, and a fresh []
// literal on every render would defeat CategoryGroup's memo.
const EMPTY_GEAR_ITEMS: ListItemWithGear[] = []

// The public /r/:slug read-only view. One anonymous GET returns the whole
// share (list + items + referenced categories) as the narrow public
// allowlist; this page maps narrow -> wide at a single boundary so the
// rendering components shared with the authed views keep their full type
// signatures. The placeholder values never reach the wire - they exist so
// downstream components see valid wide types, and the corresponding UI
// (pack mode, owner-only affordances) doesn't render here.
//
// product flag below makes it dormant without changing the locked public wire
// shape or deleting the owner's stored plan.
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>()
  // Share-scoped unit, held locally and persisted under its own key. Lazy
  // initializer so localStorage is read once on mount, not every render; it
  // reads through to the authenticated preference when the share key is unset,
  // so an owner opening their own link still starts in their usual units.
  //
  // Plain useState rather than a second useSyncExternalStore: nothing else in
  // the app writes this key, so there are no other subscribers to keep in
  // lockstep, and a public page has no cross-tab sync requirement.
  const [weightUnit, setWeightUnitState] = useState<WeightUnit>(getShareWeightUnit)
  function setShareUnit(unit: WeightUnit) {
    setShareWeightUnit(unit)
    setWeightUnitState(unit)
  }
  const isBelowLg = useIsBelowLg()

  // data is undefined while loading, null for "not a shared list" (the
  // fetcher maps ONLY the 404 to null), and the share otherwise. Real
  // outages (network, 5xx) reject and land in isLoadingError below.
  const { data: share, isPending, isLoadingError } = useQuery(queries.sharedList(slug))
  useDocumentTitle(share?.list.name ?? null)

  // Failure, then loading, then not-found (AGENTS.md), because "List not
  // found" is a claim only a settled answer supports.
  // isLoadingError, not isError: v5 sets isError after a failed BACKGROUND
  // refetch too, while keeping the data, and that must not replace a
  // rendered share with the error panel.
  // A real outage is distinct from a bad slug: showing "List not found"
  // for a transient error would mislead the viewer into thinking the
  // owner stopped sharing.
  if (isLoadingError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">Couldn't load list</p>
          <p className="mt-1 text-sm text-gray-500">Check your connection and try again.</p>
        </div>
      </div>
    )
  }

  // isPending, not isLoading: v5's isLoading is `isPending && isFetching`, and
  // a fetch paused offline (or between retries in a hidden tab) has
  // fetchStatus 'paused', so isLoading was false with no data and the page
  // fell through to "List not found".
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  if (!share) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">List not found</p>
          <p className="mt-1 text-sm text-gray-500">This link may be invalid or sharing has been turned off.</p>
        </div>
      </div>
    )
  }

  const { list, items, categories } = share

  // The narrow -> wide boundary. gear status is filled with 'active' so
  // ItemRow renders no status badge - equivalent to "not shown" (status
  // is private inventory metadata the wire response omits). isPacked /
  // isReady placeholders are dead here because pack mode never renders on
  // the share view.
  const itemsForRender: ListItemWithGear[] = items.map((item) => ({
    id: item.id,
    listId: '',
    gearItemId: item.gearItemId,
    quantity: item.quantity,
    isWorn: item.isWorn,
    isConsumable: item.isConsumable,
    isPacked: false,
    isReady: false,
    packingLocationId: null,
    sortOrder: item.sortOrder,
    // Placeholder, and permanently so: the share wire response has no pack
    // rank and never will - how someone arranged their bags is not part of
    // what a share link publishes. The share view never enters pack mode, so
    // nothing reads this.
    packSortOrder: 0,
    createdAt: '',
    updatedAt: '',
    gearItem: {
      id: item.gearItemId,
      categoryId: item.gear.categoryId,
      name: item.gear.name,
      description: item.gear.description,
      weightGrams: item.gear.weightGrams,
      cost: null,
      purchaseDate: null,
      status: 'active' as const,
      sortOrder: 0,
      createdAt: '',
      updatedAt: '',
    },
  }))
  const categoriesForRender: Category[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    sortOrder: c.sortOrder,
    createdAt: '',
  }))

  // The share's own totals used to call the gear-only reducer, so a shared
  // list reported a lighter pack than the same list did to its owner. The
  // compositor cannot be called without a food figure, and the DTO carries
  // the rows to compute one.
  //
  // Summed here with the same helper the owner's page uses, rather than read
  // off a number the server computed. That is the point of publishing rows:
  // one definition of food weight instead of two that could drift.
  const foodGrams = foodGramsFor(share.food.items)
  const weightBreakdown = computeListWeightBreakdown({
    gear: { items: itemsForRender, categories: categoriesForRender },
    food: { grams: foodGrams },
  })

  // A list can weigh something with no GEAR rows on it - food-only is a real
  // shape now that food contributes to the total. Keying this on items.length
  // alone hid the whole summary for exactly that list, so the one number a
  // reader came for disappeared.
  const showWeightSummary = items.length > 0 || weightBreakdown.totalPackGrams > 0

  // Group items by category, ordered by category.sortOrder; uncategorized
  // last. Read-only view - no `prior` stability arg (renders once per
  // slug fetch).
  const grouped = groupListItemsByCategory(itemsForRender, categoriesForRender)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {list.isDraft && <DraftBanner />}
        {/* Header. Viewers don't have Settings access, so the share page
            keeps its own units control. Rendered label-less: the g / oz
            segmented chrome self-describes, and dropping the word keeps
            it tidy inline with the list title.

            It drives a SHARE-SCOPED preference, never the authenticated app's.
            This page is anonymous and may be opened by anyone, including on a
            borrowed browser; it used to write the same key the signed-in app
            reads, so a stranger picking oz here silently reconfigured that
            device's own gear and lists views. The choice still persists on
            this device - it just no longer reaches into the app. */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-gray-900">{list.name}</h1>
          <UnitSegmentedControlView
            idPrefix="share"
            value={weightUnit}
            onValueChange={setShareUnit}
          />
        </div>

        {/* Notes + Weight summary - side by side on desktop, with Notes
            getting the wider read-only column. A list with no notes renders
            no Notes panel at all: "No notes" tells a stranger nothing and
            reserved ~160px of a phone screen for it. (The owner's editor
            keeps its placeholder - the panel is an editing surface there.)
            Without notes the summary keeps roughly its two-column width
            instead of stretching the table across the whole page. */}
        {(list.description || showWeightSummary) && (
          <div className={`mb-6 grid gap-4 ${list.description && showWeightSummary ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
            {list.description && (
              <PanelCard title="Notes">
                <div className="px-3 py-2 min-h-[8rem]">
                  <Suspense fallback={null}>
                    <MarkdownContent content={list.description} />
                  </Suspense>
                </div>
              </PanelCard>
            )}
            {showWeightSummary && (
              <div className={list.description ? undefined : 'lg:max-w-md'}>
                <PanelCard title="Weight summary">
                  <WeightTable items={itemsForRender} categories={categoriesForRender} breakdown={weightBreakdown} />
                </PanelCard>
              </div>
            )}
          </div>
        )}

        {items.length === 0 && (
          <div className={`px-3 py-4 ${FLAT_TABLE_SURFACE}`}>
            <p className={PANEL_EMPTY_TEXT}>No gear items have been added to this shared list yet.</p>
          </div>
        )}

        {/* Items grouped by category - sections stacked flush on a white
            table surface. The shared category headers are gray dividers;
            without this surface they blend into SharePage's gray page
            background. */}
        {(items.length > 0 || share.food.items.length > 0) && (
          <div className="flex flex-col gap-3">
            {grouped.map((group) => (
              <CategoryGroup
                key={group.category?.id ?? '__uncategorized__'}
                name={group.category?.name ?? 'Uncategorized'}
                items={group.items}
                weightUnit={weightUnit}
                isBelowLg={isBelowLg}
                collapsible={false}
                baseSubtotalGrams={baseGramsForCategory(weightBreakdown, group.category?.id ?? null)}
                consumableSubtotalGrams={consumableGramsForCategory(weightBreakdown, group.category?.id ?? null)}
                wornSubtotalGrams={wornGramsForCategory(weightBreakdown, group.category?.id ?? null)}
              />
            ))}
            {/* No trailing Worn section here: worn rows stay inside their
                category with the worn icon, matching the owner's Category
                arrangement (section-rows.ts owns the rule; pack mode is the
                one view that extracts worn). This also means a category whose
                items are all worn no longer renders as an empty section. */}
            {/* Food, as its own trailing section rather than mixed into the
                gear categories: it is not filed under one, and grouping it
                with gear would need a category it does not have.
                The subtotal goes through the CONSUMABLE channel: food is
                consumable by definition, which is the bucket its grams
                already land in upstream. */}
            {share.food.items.length > 0 && (
              <CategoryGroup
                name="Food"
                items={EMPTY_GEAR_ITEMS}
                regionKey="food"
                foodRows={share.food.items}
                weightUnit={weightUnit}
                isBelowLg={isBelowLg}
                collapsible={false}
                consumableSubtotalGrams={foodGrams}
              />
            )}
          </div>
        )}


        {/* The old repo linked to /about here; that page doesn't exist on
            this stack (yet), so the footer credit points home instead. */}
        <div className="mt-8 text-center">
          <Link to="/" className="text-xs text-gray-500 hover:text-gray-600">
            Made with grampacker
          </Link>
        </div>
      </div>
    </div>
  )
}
