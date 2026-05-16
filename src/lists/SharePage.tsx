import { Suspense, lazy, useMemo } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSharedList, fetchSharedListItems, fetchSharedListCategories } from '../lib/queries'
import { groupListItemsByCategory } from '../lib/grouping'
import type { Category, ListItemWithGear, PublicCategory, PublicListItem } from '../lib/types'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useDocumentTitle } from '../lib/use-document-title'
import WeightTable from './WeightTable'
import PanelCard from './PanelCard'
import CategoryGroup from './CategoryGroup'
import AboutLink from '../components/AboutLink'
import OfflineBanner from '../components/OfflineBanner'

// Notes are rendered as Markdown on the public share view (typing markdown
// in the authed NotesEditor textarea is the only authoring path). Lazy so
// the react-markdown + remark-gfm chunk (~46 KB gzip) doesn't land in the
// share-view cold-load when the list has no description.
const MarkdownContent = lazy(() => import('../components/MarkdownContent'))

export default function SharePage() {
  const { slug } = useParams<{ slug: string }>()
  const { weightUnit, toggleWeightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()

  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['shared-list', slug],
    queryFn: () => fetchSharedList(slug!),
    enabled: Boolean(slug),
  })
  useDocumentTitle(list?.name ?? null)

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['shared-list-items', list?.id],
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

  const { data: categories = [] } = useQuery({
    queryKey: ['shared-list-categories', list?.id, [...categoryIds].sort().join(',')],
    queryFn: () => fetchSharedListCategories(categoryIds),
    enabled: Boolean(list?.id) && categoryIds.length > 0,
  })

  if (listLoading || itemsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
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
    created_at: '',
    updated_at: '',
  }))
  const categoriesForRender: Category[] = categories.map((c: PublicCategory) => ({
    ...c,
    user_id: '',
    is_default: false,
    created_at: '',
  }))

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

  return (
    <div className="min-h-screen bg-gray-50">
      <OfflineBanner />
      <div className="mx-auto max-w-5xl px-4 py-10">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <h1 className="flex-1 min-w-0 truncate text-xl font-semibold text-gray-900">{list.name}</h1>
          <button
            onClick={toggleWeightUnit}
            title={`Switch to ${weightUnit === 'g' ? 'oz' : 'g'}`}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            {weightUnit}
          </button>
        </div>

        {/* Notes + Weight summary — side by side on desktop, with Notes
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
              <p className="px-3 py-2 text-sm text-gray-400 italic min-h-[8rem]">No notes</p>
            )}
          </PanelCard>
          {items.length > 0 && (
            <PanelCard title="Weight summary">
              <WeightTable items={itemsForRender} categories={categoriesForRender} />
            </PanelCard>
          )}
        </div>

        {/* Items grouped by category */}
        <div className="space-y-4">
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

        <div className="mt-8 text-center">
          <AboutLink className="text-xs text-gray-400 hover:text-gray-600" />
        </div>
      </div>
    </div>
  )
}
