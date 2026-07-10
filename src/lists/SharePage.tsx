import { Suspense, lazy } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Eye } from 'lucide-react'
import { fetchSharedList, queryKeys } from '../lib/queries'
import { groupListItemsByCategory } from '../lib/grouping'
import type { Category, ListItemWithGear, SharedListResponse } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useDocumentTitle } from '../lib/use-document-title'
import { computeWeightBreakdown } from '../lib/weight-breakdown'
import WeightTable from './WeightTable'
import PanelCard from './PanelCard'
import CategoryGroup from './CategoryGroup'
import DraftBanner from './DraftBanner'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import { FLAT_TABLE_SURFACE, PANEL_EMPTY_TEXT } from '../components/flat-table-styles'

// Notes are rendered as Markdown on the public share view (typing markdown
// in the authed NotesEditor textarea is the only authoring path). Lazy so
// the react-markdown + remark-gfm chunk doesn't land in the share-view
// cold-load when the list has no description.
const MarkdownContent = lazy(() => import('../components/MarkdownContent'))

// The public /r/:slug read-only view. One anonymous GET returns the whole
// share (list + items + referenced categories) as the narrow public
// allowlist; this page maps narrow -> wide at a single boundary so the
// rendering components shared with the authed views keep their full type
// signatures. The placeholder values never reach the wire - they exist so
// downstream components see valid wide types, and the corresponding UI
// (pack mode, owner-only affordances) doesn't render here.
//
// TRANSPLANT NOTE (food): the old SharePage also had a Gear/Food tab strip
// (is_food_shared-gated), the projected-food weight row, and food weight
// composed into the breakdown via withProjectedFood. All of it returns
// with the food slice.
export default function SharePage() {
  const { slug } = useParams<{ slug: string }>()
  const { weightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()

  // data is undefined while loading, null for "not a shared list" (the
  // fetcher maps ONLY the 404 to null), and the share otherwise. Real
  // outages (network, 5xx) reject and land in isError below.
  const { data: share, isLoading, isError } = useQuery<SharedListResponse | null>({
    queryKey: queryKeys.sharedList(slug),
    queryFn: () => fetchSharedList(slug!),
    enabled: Boolean(slug),
  })
  useDocumentTitle(share?.list.name ?? null)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  // A real outage is distinct from a bad slug: showing "List not found"
  // for a transient error would mislead the viewer into thinking the
  // owner stopped sharing.
  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">Couldn't load list</p>
          <p className="mt-1 text-sm text-gray-400">Check your connection and try again.</p>
        </div>
      </div>
    )
  }

  if (!share) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-base font-medium text-gray-700">List not found</p>
          <p className="mt-1 text-sm text-gray-400">This link may be invalid or sharing has been turned off.</p>
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
    sortOrder: item.sortOrder,
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

  const weightBreakdown = computeWeightBreakdown(itemsForRender, categoriesForRender)

  // Group items by category, ordered by category.sortOrder; uncategorized
  // last. Read-only view - no `prior` stability arg (renders once per
  // slug fetch).
  const grouped = groupListItemsByCategory(itemsForRender, categoriesForRender)

  // Honor the owner's per-list "Group worn" preference. When on, worn items
  // are filtered out of category sections (via CategoryGroup's hideWorn)
  // and rendered in a trailing Worn section, mirroring the authed
  // ListDetailPage. Share view is read-only; no toggle here.
  const showWornGroup = list.groupWorn
  const wornItems = showWornGroup
    ? grouped.flatMap((g) => g.items.filter((i) => i.isWorn))
    : []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        {list.isDraft && <DraftBanner />}
        {/* Header. Viewers don't have Settings access, so the share page
            keeps its own units control. Rendered label-less: the g / oz
            segmented chrome self-describes, and dropping the word keeps
            it tidy inline with the list title. Writes through the same
            useWeightUnit store, so the choice persists on this device. */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-gray-900">{list.name}</h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
            <Eye size={13} aria-hidden="true" />
            Public - read-only
          </span>
          <UnitSegmentedControl idPrefix="share" />
        </div>

        {/* Notes + Weight summary - side by side on desktop, with Notes
            getting the wider read-only column. */}
        <div className={`mb-6 grid gap-4 ${items.length > 0 ? 'grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]' : 'grid-cols-1'}`}>
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
          {items.length > 0 && (
            <PanelCard title="Weight summary">
              <WeightTable items={itemsForRender} categories={categoriesForRender} breakdown={weightBreakdown} />
            </PanelCard>
          )}
        </div>

        {items.length === 0 && (
          <div className={`px-3 py-4 ${FLAT_TABLE_SURFACE}`}>
            <p className={PANEL_EMPTY_TEXT}>No gear items have been added to this shared list yet.</p>
          </div>
        )}

        {/* Items grouped by category - sections stacked flush on a white
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

        {/* The old repo linked to /about here; that page doesn't exist on
            this stack (yet), so the footer credit points home instead. */}
        <div className="mt-8 text-center">
          <Link to="/" className="text-xs text-gray-400 hover:text-gray-600">
            Made with grampacker
          </Link>
        </div>
      </div>
    </div>
  )
}
