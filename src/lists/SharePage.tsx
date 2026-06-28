import { Suspense, lazy, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import {
  fetchSharedList, fetchSharedListItems, fetchSharedListCategories,
  fetchSharedFoodSummary, fetchSharedFoodPlan, queryKeys,
} from '../lib/queries'
import { groupListItemsByCategory } from '../lib/grouping'
import type { Category, ListItemWithGear, PublicCategory, PublicListItem } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useDocumentTitle } from '../lib/use-document-title'
import { computeWeightBreakdown, withProjectedFood } from '../lib/weight-breakdown'
import WeightTable from './WeightTable'
import PanelCard from './PanelCard'
import CategoryGroup from './CategoryGroup'
import FoodSummaryRow from './FoodSummaryRow'
import AboutLink from '../components/AboutLink'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import DraftBanner from './DraftBanner'
import { PANEL_EMPTY_TEXT } from '../components/flat-table-styles'
import PublicFoodPlanSection from '../food/PublicFoodPlanSection'

// Notes are rendered as Markdown on the public share view (typing markdown
// in the authed NotesEditor textarea is the only authoring path). Lazy so
// the react-markdown + remark-gfm chunk (~46 KB gzip) doesn't land in the
// share-view cold-load when the list has no description.
const MarkdownContent = lazy(() => import('../components/MarkdownContent'))

export default function SharePage() {
  const { slug } = useParams<{ slug: string }>()
  const { weightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()
  const [activeTab, setActiveTab] = useState<'gear' | 'food'>('gear')

  const { data: list, isLoading: listLoading, isError: listError } = useQuery({
    queryKey: queryKeys.sharedList(slug),
    queryFn: () => fetchSharedList(slug!),
    enabled: Boolean(slug),
  })
  useDocumentTitle(list?.name ?? null)

  const { data: items = [], isLoading: itemsLoading, isError: itemsError } = useQuery({
    queryKey: queryKeys.sharedListItems(list?.id),
    // Safe non-null: `enabled: Boolean(list?.id)` gates the queryFn so it
    // only runs after fetchSharedList resolved with a real list.
    queryFn: () => fetchSharedListItems(list!.id),
    enabled: Boolean(list?.id),
  })

  // Fetch only the categories actually referenced by this list's items.
  // Memoized so unrelated parent re-renders don't recompute the dedupe.
  const categoryIds = useMemo(
    () =>
      [...new Set(
        items.map((i) => i.gear_item.category_id).filter((c): c is string => c !== null),
      )],
    [items],
  )

  const { data: categories = [], isError: categoriesError } = useQuery({
    queryKey: queryKeys.sharedListCategories(list?.id, categoryIds.toSorted().join(',')),
    queryFn: () => fetchSharedListCategories(categoryIds),
    enabled: Boolean(list?.id) && categoryIds.length > 0,
  })

  const { data: foodSummaryGrams = 0, isLoading: foodSummaryLoading, isError: foodSummaryError } = useQuery({
    queryKey: queryKeys.sharedFoodSummary(slug ?? ''),
    queryFn: () => fetchSharedFoodSummary(slug!),
    enabled: Boolean(list?.id) && Boolean(slug),
  })
  const { data: sharedFoodPlan = null, isLoading: foodPlanLoading, isError: foodPlanError } = useQuery({
    queryKey: queryKeys.sharedFoodPlan(slug ?? ''),
    queryFn: () => fetchSharedFoodPlan(slug!),
    enabled: Boolean(list?.id) && Boolean(slug),
  })

  if (listLoading || itemsLoading || foodSummaryLoading || foodPlanLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  // Real outage (network, 5xx, RLS misconfig, runtime shape-guard
  // throw in fetchSharedListItems) is distinct from a bad slug:
  // fetchSharedList only returns null for PGRST116 ("no row from
  // .single()"). Showing "List not found" for a transient error would
  // mislead the viewer into thinking the owner stopped sharing — and
  // an items/categories fetch failure rendering as an empty list would
  // do the same in reverse.
  if (listError || itemsError || categoriesError || foodSummaryError || foodPlanError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">Couldn't load list</p>
          <p className="mt-1 text-sm text-gray-400">Check your connection and try again.</p>
        </div>
      </div>
    )
  }

  if (!list) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">List not found</p>
          <p className="mt-1 text-sm text-gray-400">This link may be invalid or sharing has been turned off.</p>
        </div>
      </div>
    )
  }

  // Public response is intentionally narrower than the authenticated
  // response (see SECURITY.md "Public read paths"). Map narrow → wide here
  // so downstream components (shared with authed views) keep their full
  // type signatures. The defaults below are placeholders that never reach
  // the wire — the actual wire response only contains the public-allowlist
  // columns. Reading these fields downstream would yield the placeholder
  // values, which is fine for share view because the corresponding UI
  // (pack mode, owner-only affordances) doesn't render here.
  const itemsForRender: ListItemWithGear[] = items.map((i: PublicListItem) => ({
    ...i,
    user_id: '',
    list_id: list.id,
    is_packed: false,
    // Ready Checks are private pack-mode state; the public wire response
    // omits is_ready (asserted in shared-projections.test.ts). Fill with
    // a placeholder so downstream components see a valid ListItemWithGear.
    is_ready: false,
    created_at: '',
    updated_at: '',
    // Status is private inventory metadata; the public wire response omits
    // it (see SECURITY.md "Public read column allowlist" and the assertion
    // in shared-projections.test.ts). Fill with 'active' here so the shared
    // ItemRow component renders no badge — equivalent to "not shown".
    gear_item: { ...i.gear_item, status: 'active' as const },
  }))
  const categoriesForRender: Category[] = categories.map((c: PublicCategory) => ({
    ...c,
    user_id: '',
    is_default: false,
    created_at: '',
  }))

  const projectedFoodGrams = foodSummaryGrams
  const weightBreakdown = withProjectedFood(
    computeWeightBreakdown(itemsForRender, categoriesForRender),
    projectedFoodGrams,
  )

  // Group items by category, ordered by category.sort_order; uncategorized last.
  // Read-only view — no `prior` stability arg (renders once per slug-fetch).
  const grouped = groupListItemsByCategory(itemsForRender, categoriesForRender)

  // Honor the owner's per-list "Group worn" preference. When on, worn items
  // are filtered out of category sections (via CategoryGroup's hideWorn)
  // and rendered in a trailing Worn section, mirroring the authed
  // ListDetailPage. Share view is read-only; no toggle here.
  const showWornGroup = list.group_worn
  const wornItems = showWornGroup
    ? grouped.flatMap((g) => g.items.filter((i) => i.is_worn))
    : []
  const showFoodPlan = Boolean(sharedFoodPlan)
  const showingFoodPlan = showFoodPlan && activeTab === 'food'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* Header. Viewers don't have Settings access, so the share page
            keeps its own units control. Rendered label-less: the g / oz
            segmented chrome self-describes, and dropping the word keeps
            it tidy inline with the list title. Writes through the same
            useWeightUnit store, so the choice persists on this device. */}
        {list.is_draft && <DraftBanner />}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-gray-900">{list.name}</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
            <Eye size={13} aria-hidden="true" />
            Public - read-only
          </span>
          <UnitSegmentedControl idPrefix="share" />
        </div>
        {showFoodPlan && (
          <div className="mb-4 flex gap-1 border-b border-gray-200">
            <button
              type="button"
              onClick={() => setActiveTab('gear')}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === 'gear' ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Gear list
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('food')}
              className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === 'food' ? 'border-blue-600 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              Food plan
            </button>
          </div>
        )}

        {showingFoodPlan && sharedFoodPlan ? (
          <PublicFoodPlanSection doc={sharedFoodPlan} />
        ) : (
          <>
        {/* Notes + Weight summary — side by side on desktop, with Notes
            getting the wider read-only column. */}
        <div className={`mb-6 grid gap-4 ${items.length > 0 || projectedFoodGrams > 0 ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
          <PanelCard title="Notes">
            {list.description ? (
              <div className="px-3 py-2 min-h-[8rem]">
                <Suspense fallback={null}>
                  <MarkdownContent content={list.description} />
                </Suspense>
              </div>
            ) : (
              <p className={`px-3 py-2 min-h-[8rem] ${PANEL_EMPTY_TEXT}`}>No notes</p>
            )}
          </PanelCard>
          {(items.length > 0 || projectedFoodGrams > 0) && (
            <PanelCard title="Weight summary">
              <WeightTable items={itemsForRender} categories={categoriesForRender} breakdown={weightBreakdown} />
            </PanelCard>
          )}
        </div>

        {projectedFoodGrams > 0 && (
          <div className="mb-6">
            <FoodSummaryRow grams={projectedFoodGrams} />
          </div>
        )}

        {/* Items grouped by category — sections stacked flush on a white
            table surface. The shared category headers are gray dividers;
            without this surface they blend into SharePage's gray page
            background. */}
        {items.length > 0 && (
          <div className="flex flex-col gap-3">
            {grouped.map((group) => (
              <CategoryGroup
                key={group.category?.id ?? '__uncategorized__'}
                name={group.category?.name ?? 'Uncategorized'}
                items={group.items}
                weightUnit={weightUnit}
                isBelowLg={isBelowLg}
                collapsible={false}
                hideWorn={showWornGroup}
              />
            ))}
            {showWornGroup && wornItems.length > 0 && (
              <CategoryGroup
                name="Worn"
                items={wornItems}
                weightUnit={weightUnit}
                isBelowLg={isBelowLg}
                collapsible={false}
              />
            )}
          </div>
        )}
          </>
        )}

        <div className="mt-8 text-center">
          <AboutLink className="text-xs text-gray-400 hover:text-gray-600" />
        </div>
      </div>
    </div>
  )
}
