import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X, Download, Upload, FileText } from 'lucide-react'
import { useRequireSession } from '../auth/use-require-session'
import { useDocumentTitle } from '../lib/use-document-title'
import {
  queryKeys,
  fetchFoodItems,
  createFoodItem,
  updateFoodItem,
  deleteFoodItem,
  nextFoodItemSortOrder,
  assertFoodItemWithinCap,
  importFoodItems,
  makeOptimisticInsert,
  makeOptimisticUpdate,
  makeOptimisticDelete,
  type FoodItemInput,
} from '../lib/queries'
import { showToast } from '../lib/toast'
import { foodItemsToCsv, downloadCsv, parseFoodCsv, type FoodImportRow } from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_BODY_TEXT_MUTED,
  FLAT_TABLE_EYEBROW,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_SURFACE,
  TABLE_DIVIDER_LINE,
} from '../components/flat-table-styles'
import PrimaryButton from '../components/PrimaryButton'
import Modal from '../components/Modal'
import ToggleSwitch from '../components/ToggleSwitch'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import { formatItemWeight } from '../lib/weight'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsMobile } from '../lib/use-breakpoint'
import { formatCalorieDensity, formatRatio } from './nutrition-format'
import { FoodRowKebab } from './FoodItemRow'
import FoodItemDialog from './FoodItemDialog'
import FoodImportPreviewDialog from './FoodImportPreviewDialog'
import FoodCsvFormatDialog from './FoodCsvFormatDialog'
import type { FoodItem } from '../lib/types'

type SortKey =
  | 'name'
  | 'calories'
  | 'density'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'fiber'
  | 'sodium'
  | 'potassium'
  | 'carbProtein'

type SortState = { key: SortKey; dir: 'asc' | 'desc' }

type DialogState =
  | { type: 'create' }
  | { type: 'edit'; item: FoodItem }
  | { type: 'delete'; item: FoodItem; returnDialog?: DialogState }
  | { type: 'import-preview'; rows: FoodImportRow[] }
  | { type: 'import-error'; message: string }
  | { type: 'csv-format' }

const SORT_LABEL: Record<SortKey, string> = {
  name: 'Food',
  calories: 'Calories',
  density: 'Density',
  protein: 'Protein',
  carbs: 'Carbs',
  fat: 'Fat',
  fiber: 'Fiber',
  sodium: 'Sodium',
  potassium: 'Potassium',
  carbProtein: 'C:P',
}

// The mobile card layout has no clickable column headers, so it drives the
// shared sort state through a single "Sort by" select. Keep the option set
// small and scannable (the desktop-only keys stay reachable on the table).
const MOBILE_SORTS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'calories', label: 'Calories' },
  { key: 'density', label: 'Density' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
]

function calorieDensity(food: FoodItem): number | null {
  return food.serving_weight_grams > 0
    ? food.calories_per_serving / food.serving_weight_grams
    : null
}

function carbProtein(food: FoodItem): number | null {
  if (food.carbs_grams == null || food.protein_grams == null || food.protein_grams <= 0) {
    return null
  }
  return food.carbs_grams / food.protein_grams
}

function sortValue(food: FoodItem, key: SortKey): string | number | null {
  switch (key) {
    case 'name':
      return `${food.name} ${food.brand ?? ''}`.toLowerCase()
    case 'calories':
      return food.calories_per_serving
    case 'density':
      return calorieDensity(food)
    case 'protein':
      return food.protein_grams
    case 'carbs':
      return food.carbs_grams
    case 'fat':
      return food.fat_grams
    case 'fiber':
      return food.fiber_grams
    case 'sodium':
      return food.sodium_mg
    case 'potassium':
      return food.potassium_mg
    case 'carbProtein':
      return carbProtein(food)
  }
}

function compareFoods(a: FoodItem, b: FoodItem, sort: SortState): number {
  const av = sortValue(a, sort.key)
  const bv = sortValue(b, sort.key)
  if (av == null && bv == null) return a.name.localeCompare(b.name)
  if (av == null) return 1
  if (bv == null) return -1
  const cmp = typeof av === 'string' && typeof bv === 'string'
    ? av.localeCompare(bv)
    : Number(av) - Number(bv)
  return sort.dir === 'asc' ? cmp : -cmp
}

function servingLabel(food: FoodItem, unit: 'g' | 'oz'): string {
  const weight = formatItemWeight(food.serving_weight_grams, unit)
  return food.serving_description ? `${food.serving_description} (${weight})` : weight
}

function formatGram(value: number | null): string {
  return value == null ? '-' : `${value.toFixed(1)} g`
}

function formatMg(value: number | null): string {
  return value == null ? '-' : `${Math.round(value)} mg`
}

// Compact gram value for the mobile card macro line (e.g. "10g"), where space
// is tight. The table keeps the roomier "10.0 g" via formatGram.
function compactGram(value: number | null): string {
  return value == null ? '-' : `${Math.round(value)}g`
}

export default function FoodLibraryPage() {
  useDocumentTitle('Food')
  const auth = useRequireSession()
  const userId = auth?.userId ?? ''
  const qc = useQueryClient()

  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [showMacros, setShowMacros] = useState(false)
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })
  const { weightUnit } = useWeightUnit()
  const isMobile = useIsMobile()

  const { data: allItems = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: () => fetchFoodItems(userId),
  })

  const filtered = useMemo(() => {
    const searched = !search.trim() ? allItems : allItems.filter((f) => {
      const q = search.toLowerCase()
      return f.name.toLowerCase().includes(q) || (f.brand ?? '').toLowerCase().includes(q)
    })
    return [...searched].sort((a, b) => compareFoods(a, b, sort))
  }, [allItems, search, sort])

  function toggleSort(key: SortKey) {
    setSort((curr) => {
      if (curr.key === key) return { key, dir: curr.dir === 'asc' ? 'desc' : 'asc' }
      return { key, dir: key === 'name' ? 'asc' : 'desc' }
    })
  }

  const sortedBy = (key: SortKey) => sort.key === key ? sort.dir : null

  const addItem = useMutation({
    mutationFn: (patch: FoodItemInput) =>
      createFoodItem(userId, patch, nextFoodItemSortOrder(allItems)),
    ...makeOptimisticInsert<FoodItem, FoodItemInput>({
      qc,
      queryKey: queryKeys.foodItems(),
      optimistic: (patch) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        sort_order: nextFoodItemSortOrder(allItems),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...patch,
      }),
      merge: (curr, next) => [...curr, next].sort((a, b) => a.name.localeCompare(b.name)),
    }),
  })

  const editItem = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<FoodItemInput> }) =>
      updateFoodItem(id, patch),
    ...makeOptimisticUpdate<FoodItem, { id: string; patch: Partial<FoodItemInput> }>({
      qc,
      queryKey: queryKeys.foodItems(),
      id: ({ id }) => id,
      apply: (food, { patch }) => ({ ...food, ...patch }),
      invalidateKeys: [queryKeys.foodPackSignaturesAll()],
    }),
  })

  const removeItem = useMutation({
    mutationFn: (id: string) => deleteFoodItem(id),
    ...makeOptimisticDelete<FoodItem, string>({
      qc,
      queryKey: queryKeys.foodItems(),
      id: (id) => id,
      invalidateKeys: [queryKeys.foodPlansAll(), queryKeys.foodPackSignaturesAll(), queryKeys.foodPackStateAll()],
    }),
  })

  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<FoodImportRow>(parseFoodCsv, {
    onParsed: (rows) => setDialog({ type: 'import-preview', rows }),
    onError: (message) => setDialog({ type: 'import-error', message }),
  })

  const importItems = useMutation({
    mutationFn: (items: FoodItemInput[]) => importFoodItems(userId, items, allItems),
    onSuccess: ({ newCount }) => {
      qc.invalidateQueries({ queryKey: queryKeys.foodItems() })
      setDialog(null)
      showToast(`Imported ${newCount} food${newCount === 1 ? '' : 's'}`, { type: 'success' })
    },
    // Surface failures (e.g. the cap preflight) in the import-error dialog
    // instead of leaving the preview open with no feedback.
    onError: (err) =>
      setDialog({
        type: 'import-error',
        message: err instanceof Error ? err.message : 'Could not import CSV. Try again.',
      }),
  })

  function handleSave(patch: FoodItemInput) {
    if (dialog?.type === 'edit') {
      editItem.mutate({ id: dialog.item.id, patch }, { onSuccess: () => setDialog(null) })
      return
    }
    try {
      assertFoodItemWithinCap(allItems)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Your food library is full.', { type: 'error' })
      return
    }
    addItem.mutate(patch, { onSuccess: () => setDialog(null) })
  }

  function handleExport() {
    downloadCsv('food-library.csv', foodItemsToCsv(allItems))
  }

  return (
    <div className="space-y-4">
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Food</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDialog({ type: 'csv-format' })}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            <FileText size={15} />
            <span className="sr-only sm:not-sr-only">CSV format</span>
          </button>
          <button
            type="button"
            onClick={openImportPicker}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            <Upload size={15} />
            <span className="sr-only sm:not-sr-only">Import</span>
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={allItems.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-40"
          >
            <Download size={15} />
            <span className="sr-only sm:not-sr-only">Export</span>
          </button>
          <PrimaryButton type="button" onClick={() => setDialog({ type: 'create' })}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={16} />
              Add food
            </span>
          </PrimaryButton>
        </div>
      </div>

      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search foods by name or brand"
          className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-9 text-sm focus:border-gray-400 focus:outline-none"
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-500">Loading your food library...</p>
      ) : isError ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-sm text-gray-600">Couldn't load your food library.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-sm font-medium text-gray-900 underline"
          >
            Try again
          </button>
        </div>
      ) : allItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <p className="text-sm text-gray-600">Your food library is empty.</p>
          <button
            type="button"
            onClick={() => setDialog({ type: 'create' })}
            className="mt-2 text-sm font-medium text-gray-900 underline"
          >
            Add your first food
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No foods match "{search}".</p>
      ) : (
        <div className={FLAT_TABLE_SURFACE}>
          <div className={`${FLAT_TABLE_HEADER} flex-wrap justify-between gap-3 px-3 py-2 lg:py-1`}>
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {filtered.length} food{filtered.length === 1 ? '' : 's'}
            </span>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
              {isMobile ? (
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <span className="text-gray-500">Sort by</span>
                  <select
                    aria-label="Sort foods by"
                    value={sort.key}
                    onChange={(e) => {
                      const key = e.target.value as SortKey
                      setSort({ key, dir: key === 'name' ? 'asc' : 'desc' })
                    }}
                    className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-gray-400 focus:outline-none"
                  >
                    {/* Surface a desktop-only active key (e.g. Fiber) as a disabled
                        option so the control reflects the real sort instead of
                        silently snapping the order to Name. */}
                    {MOBILE_SORTS.some((s) => s.key === sort.key) ? null : (
                      <option value={sort.key} disabled>{SORT_LABEL[sort.key]}</option>
                    )}
                    {MOBILE_SORTS.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                <ToggleSwitch
                  checked={showMacros}
                  onChange={() => setShowMacros((v) => !v)}
                  ariaLabel="Show macros"
                />
                <span>Show macros</span>
              </div>
              <UnitSegmentedControl idPrefix="food-library-units" />
            </div>
          </div>
          {isMobile ? (
            <FoodLibraryCardList
              foods={filtered}
              weightUnit={weightUnit}
              showMacros={showMacros}
              onEdit={(item) => setDialog({ type: 'edit', item })}
              onDelete={(item) => setDialog({ type: 'delete', item })}
            />
          ) : (
          <div className="overflow-x-auto">
            <table aria-label="Food library" className="min-w-full border-collapse">
              <thead className="bg-gray-50">
                <tr className={`border-b border-gray-100 ${FLAT_TABLE_EYEBROW}`}>
                  <SortHeader label="Food" sortKey="name" current={sortedBy('name')} onSort={toggleSort} align="left" />
                  <th scope="col" className="px-3 py-2 text-left font-semibold">Serving</th>
                  <SortHeader label="Calories" sortKey="calories" current={sortedBy('calories')} onSort={toggleSort} />
                  <SortHeader label="Density" sortKey="density" current={sortedBy('density')} onSort={toggleSort} />
                  {showMacros ? (
                    <>
                      <SortHeader label="Protein" sortKey="protein" current={sortedBy('protein')} onSort={toggleSort} />
                      <SortHeader label="Carbs" sortKey="carbs" current={sortedBy('carbs')} onSort={toggleSort} />
                      <SortHeader label="Fat" sortKey="fat" current={sortedBy('fat')} onSort={toggleSort} />
                      <SortHeader label="Fiber" sortKey="fiber" current={sortedBy('fiber')} onSort={toggleSort} />
                      <SortHeader label="Sodium" sortKey="sodium" current={sortedBy('sodium')} onSort={toggleSort} />
                      <SortHeader label="Potassium" sortKey="potassium" current={sortedBy('potassium')} onSort={toggleSort} />
                      <SortHeader label="C:P" sortKey="carbProtein" current={sortedBy('carbProtein')} onSort={toggleSort} />
                    </>
                  ) : null}
                  <th scope="col" className="w-10 px-2 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={`divide-y ${TABLE_DIVIDER_LINE}`}>
                {filtered.map((food) => (
                  <tr
                    key={food.id}
                    data-testid="food-library-row"
                    className={`${FLAT_TABLE_BODY_TEXT} bg-white hover:bg-gray-50`}
                  >
                    <td className="w-64 min-w-48 max-w-64 px-3 py-2">
                      <div className="truncate font-medium text-gray-900" title={food.name}>{food.name}</div>
                      {food.brand ? (
                        <div className={`${FLAT_TABLE_BODY_TEXT_MUTED} truncate`}>{food.brand}</div>
                      ) : null}
                    </td>
                    <td className="min-w-36 px-3 py-2 text-gray-600">
                      {servingLabel(food, weightUnit)}
                    </td>
                    <td className={`${FLAT_TABLE_NUMERIC_TEXT} px-3 py-2 text-right text-gray-900`}>
                      {food.calories_per_serving} kcal
                    </td>
                    <td className={`${FLAT_TABLE_NUMERIC_TEXT} min-w-28 px-3 py-2 text-right text-gray-900`}>
                      {formatCalorieDensity(calorieDensity(food), weightUnit)}
                    </td>
                    {showMacros ? (
                      <>
                        <MacroCell>{formatGram(food.protein_grams)}</MacroCell>
                        <MacroCell>{formatGram(food.carbs_grams)}</MacroCell>
                        <MacroCell>{formatGram(food.fat_grams)}</MacroCell>
                        <MacroCell>{formatGram(food.fiber_grams)}</MacroCell>
                        <MacroCell>{formatMg(food.sodium_mg)}</MacroCell>
                        <MacroCell>{formatMg(food.potassium_mg)}</MacroCell>
                        <MacroCell>{formatRatio(carbProtein(food))}</MacroCell>
                      </>
                    ) : null}
                    <td className="px-2 py-1 text-right">
                      <FoodRowKebab
                        name={food.name}
                        onEdit={() => setDialog({ type: 'edit', item: food })}
                        onDelete={() => setDialog({ type: 'delete', item: food })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
            Density uses each food's calories and serving weight. Unknown nutrients show as -.
          </p>
        </div>
      )}

      {(dialog?.type === 'create' || dialog?.type === 'edit') && (
        <FoodItemDialog
          key={dialog.type === 'edit' ? dialog.item.id : 'new'}
          item={dialog.type === 'edit' ? dialog.item : undefined}
          saving={addItem.isPending || editItem.isPending}
          onClose={() => setDialog(null)}
          onSave={handleSave}
          onDeleteFromInventory={
            dialog.type === 'edit'
              ? () => setDialog({ type: 'delete', item: dialog.item, returnDialog: dialog })
              : undefined
          }
        />
      )}

      {dialog?.type === 'delete' && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title="Delete from library"
          className="w-[calc(100vw-2rem)] max-w-sm"
        >
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900">Delete from library</h2>
            <p className="mt-2 text-sm text-gray-600">
              Delete "{dialog.item.name}" from your food library? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  removeItem.mutate(dialog.item.id)
                  setDialog(null)
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      )}

      {dialog?.type === 'csv-format' && (
        <FoodCsvFormatDialog onClose={() => setDialog(null)} />
      )}

      {dialog?.type === 'import-preview' && (
        <FoodImportPreviewDialog
          rows={dialog.rows}
          existingCount={allItems.length}
          saving={importItems.isPending}
          onConfirm={(items) => importItems.mutate(items)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.type === 'import-error' && (
        <Modal
          open
          onClose={() => setDialog(null)}
          title="Import failed"
          className="w-[calc(100vw-2rem)] max-w-sm"
        >
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900">Couldn't import CSV</h2>
            <p className="mt-2 text-sm text-gray-600">{dialog.message}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  current,
  onSort,
  align = 'right',
}: {
  label: string
  sortKey: SortKey
  current: 'asc' | 'desc' | null
  onSort: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const marker = current === 'asc' ? '^' : current === 'desc' ? 'v' : ''
  return (
    <th
      scope="col"
      aria-sort={current === 'asc' ? 'ascending' : current === 'desc' ? 'descending' : 'none'}
      className={`px-3 py-2 font-semibold ${align === 'left' ? 'text-left' : 'text-right'}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`Sort by ${SORT_LABEL[sortKey]}`}
        className={`inline-flex items-center gap-1 rounded text-gray-500 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          align === 'right' ? 'justify-end' : ''
        }`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="inline-block w-2 text-gray-400">{marker}</span>
      </button>
    </th>
  )
}

function MacroCell({ children }: { children: string }) {
  return (
    <td className={`${FLAT_TABLE_NUMERIC_TEXT} px-3 py-2 text-right text-gray-900`}>
      {children}
    </td>
  )
}

// Phone layout: the wide sortable table becomes a stacked, tappable card list
// (tap to edit; the kebab keeps Edit/Delete parity with the desktop row). Cards
// lead with the scannable facts - name, serving, calories, density in the
// chosen unit - and only add a compact P/C/F line when "Show macros" is on.
function FoodLibraryCardList({
  foods,
  weightUnit,
  showMacros,
  onEdit,
  onDelete,
}: {
  foods: FoodItem[]
  weightUnit: 'g' | 'oz'
  showMacros: boolean
  onEdit: (food: FoodItem) => void
  onDelete: (food: FoodItem) => void
}) {
  return (
    <ul data-testid="food-library-mobile-list" className="divide-y divide-gray-100">
      {foods.map((food) => {
        const meta = [food.brand, servingLabel(food, weightUnit)].filter(Boolean).join(', ')
        return (
          <li key={food.id} className="flex items-stretch bg-white hover:bg-gray-50">
            <button
              type="button"
              data-testid="food-library-mobile-row"
              onClick={() => onEdit(food)}
              className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-gray-900">{food.name}</span>
                {meta ? (
                  <span className={`${FLAT_TABLE_BODY_TEXT_MUTED} block truncate`}>{meta}</span>
                ) : null}
                {showMacros ? (
                  <span className={`${FLAT_TABLE_BODY_TEXT_MUTED} block truncate`}>
                    P {compactGram(food.protein_grams)}, C {compactGram(food.carbs_grams)}, F {compactGram(food.fat_grams)}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-right">
                <span className={`${FLAT_TABLE_NUMERIC_TEXT} block text-gray-900`}>
                  {food.calories_per_serving} kcal
                </span>
                <span className={`${FLAT_TABLE_NUMERIC_TEXT} block text-xs text-gray-500`}>
                  {formatCalorieDensity(calorieDensity(food), weightUnit)}
                </span>
              </span>
            </button>
            <div className="flex items-center pr-1">
              <FoodRowKebab
                name={food.name}
                onEdit={() => onEdit(food)}
                onDelete={() => onDelete(food)}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
