import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Download, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { queryKeys, fetchFoodItems, importFoodItems } from '../lib/queries'
import {
  FOOD_CSV_HEADER,
  FOOD_SAMPLE_CSV,
  downloadCsv,
  foodItemsToCsv,
  parseFoodCsv,
  type FoodImportRow,
} from '../lib/csv'
import { useCsvFileInput } from '../lib/use-csv-file-input'
import { showToast } from '../lib/toast'
import type { CreateFoodItemRequest } from '../../shared/food'
import type { FoodItem } from '../lib/types'
import { ApiError } from '../lib/api'
import { useWeightUnit } from '../lib/use-weight-unit'
import { useIsBelowLg } from '../lib/use-breakpoint'
import { useDocumentTitle } from '../lib/use-document-title'
import PrimaryButton from '../components/PrimaryButton'
import ConfirmDialog from '../components/ConfirmDialog'
import Modal from '../components/Modal'
import FoodTabs from './FoodTabs'
import FoodItemDialog, { type FoodPatch } from './FoodItemDialog'
import MobileFoodActionBar from './MobileFoodActionBar'
import FoodOptionsButton from './FoodOptionsButton'
import FoodImportPreviewDialog from './FoodImportPreviewDialog'
import { useFoodItemActions } from './use-food-item-actions'
import { NUMERIC_VALUE_TEXT, ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import {
  calorieDensity,
  carbProteinRatio,
  formatCalorieDensity,
  formatGrams,
  formatMilligrams,
  formatRatio,
  formatServingDescriptor,
} from './serving-format'

type DialogState =
  | { type: 'create' }
  | { type: 'edit'; item: FoodItem }
  | { type: 'delete'; item: FoodItem; returnDialog?: DialogState }
  | { type: 'import-explainer' }
  | { type: 'import-preview'; rows: FoodImportRow[] }
  | { type: 'import-error'; message: string }

type SortKey = 'name' | 'calories' | 'density'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

// Null-last comparator: an unknown value always sorts after a known one,
// regardless of direction, so toggling asc/desc never floats "-" to the top.
function compareNullable(
  a: number | null,
  b: number | null,
  dir: 'asc' | 'desc',
): number {
  // Unknown values always sort last, in both directions.
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const diff = a - b
  return dir === 'asc' ? diff : -diff
}

export default function FoodLibraryPage() {
  useDocumentTitle('Food')
  const { weightUnit } = useWeightUnit()
  const isBelowLg = useIsBelowLg()

  const {
    data: allItems = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.foodItems(),
    queryFn: fetchFoodItems,
  })

  const [search, setSearch] = useState('')
  const [showMacros, setShowMacros] = useState(false)
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const { addItem, editItem, removeItem } = useFoodItemActions(allItems)

  // ── CSV import/export (the GearLibraryPage pattern) ─────────────────────
  const qc = useQueryClient()
  const {
    inputRef: importInputRef,
    onChange: handleImportFile,
    openPicker: openImportPicker,
  } = useCsvFileInput<FoodImportRow>(parseFoodCsv, {
    onParsed: (rows) => setDialog({ type: 'import-preview', rows }),
    onError: (message) => setDialog({ type: 'import-error', message }),
  })

  function handleExport() {
    try {
      downloadCsv('food-library.csv', foodItemsToCsv(allItems))
    } catch {
      showToast("Couldn't export the food library. Please try again.", { type: 'error' })
    }
  }

  // Confirmed import: one POST, the server inserts every row in one
  // transaction (422 past the cap writes nothing). The preview only enables
  // Import when ALL rows are valid, so `items` is every parsed row.
  const importItems = useMutation({
    mutationFn: (items: CreateFoodItemRequest[]) => importFoodItems(items),
    onSuccess: () => {
      // Create-only: brand-new foods are referenced by no plan, so only the
      // library cache goes stale - the same argument as addItem in
      // use-food-item-actions.ts. ['shared-list'] deliberately untouched.
      void qc.invalidateQueries({ queryKey: queryKeys.foodItems() })
      setDialog(null)
    },
    // Surface failures (e.g. the 1000-food cap 422) in the import-error
    // dialog instead of leaving the preview open with no feedback.
    onError: (err) =>
      setDialog({
        type: 'import-error',
        message: errorMessage(err) ?? 'Could not import CSV. Try again.',
      }),
  })

  // The open dialog surfaces a create/edit failure inline (e.g. the cap 422).
  const saveError =
    dialog?.type === 'create'
      ? errorMessage(addItem.error)
      : dialog?.type === 'edit'
        ? errorMessage(editItem.error)
        : null

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems
    const q = search.trim().toLowerCase()
    return allItems.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.brand?.toLowerCase().includes(q) ?? false),
    )
  }, [allItems, search])

  const sorted = useMemo(() => {
    const rows = [...filtered]
    rows.sort((a, b) => {
      let primary = 0
      if (sort.key === 'name') {
        primary =
          sort.dir === 'asc'
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name)
      } else if (sort.key === 'calories') {
        primary = compareNullable(
          a.caloriesPerServing,
          b.caloriesPerServing,
          sort.dir,
        )
      } else {
        primary = compareNullable(
          calorieDensity(a),
          calorieDensity(b),
          sort.dir,
        )
      }
      return primary !== 0 ? primary : a.name.localeCompare(b.name)
    })
    return rows
  }, [filtered, sort])

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )
  }

  return (
    <div>
      <FoodTabs />

      {/* Hidden file input for CSV import. Mounted at the page level so it's
          always reachable via importInputRef.current.click(), even while the
          explainer dialog is unmounting (the GearLibraryPage pattern). */}
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-3">
        <div className="flex w-full items-baseline gap-2">
          <h1 className="text-xl font-semibold text-gray-900">Foods</h1>
          <span className="text-sm text-gray-500">{allItems.length} foods</span>
        </div>

        <div className="relative min-w-0 flex-1 md:w-64 md:flex-none">
          <label className="sr-only" htmlFor="food-library-search">Search foods</label>
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            id="food-library-search"
            type="search"
            placeholder="Search foods by name or brand"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <label className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={showMacros}
            onChange={(e) => setShowMacros(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          Show macros
        </label>

        {/* Desktop-only (>=lg): below lg the bottom bar's Add slot and
            Options modal own these actions, so the header cluster would
            duplicate them. lg (not md) is deliberate - the bar is lg:hidden,
            so lg:flex hands off at exactly the width the bar disappears,
            leaving one affordance of each kind at every width. */}
        <div className="ml-auto hidden lg:flex items-center gap-2">
          <PrimaryButton onClick={() => setDialog({ type: 'create' })} size="sm">
            <span className="inline-flex items-center gap-1.5">
              <Plus size={14} />
              New food
            </span>
          </PrimaryButton>
          <FoodOptionsButton
            onImport={() => setDialog({ type: 'import-explainer' })}
            onExport={handleExport}
            canExport={allItems.length > 0}
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : isError && allItems.length === 0 ? (
        <p className="text-sm text-red-600">
          Couldn&apos;t load the food library. Refresh the page and try again.
        </p>
      ) : allItems.length === 0 ? (
        <FoodLibraryEmptyState
          onCreate={() => setDialog({ type: 'create' })}
          onImport={() => setDialog({ type: 'import-explainer' })}
        />
      ) : sorted.length === 0 ? (
        <p className="text-sm text-gray-500">No foods match &ldquo;{search}&rdquo;.</p>
      ) : isBelowLg ? (
        <FoodCardList
          rows={sorted}
          unit={weightUnit}
          showMacros={showMacros}
          onEdit={(item) => setDialog({ type: 'edit', item })}
          onDelete={(item) => setDialog({ type: 'delete', item })}
        />
      ) : (
        <FoodTable
          rows={sorted}
          unit={weightUnit}
          showMacros={showMacros}
          sort={sort}
          onSort={toggleSort}
          onEdit={(item) => setDialog({ type: 'edit', item })}
          onDelete={(item) => setDialog({ type: 'delete', item })}
        />
      )}

      {(dialog?.type === 'create' || dialog?.type === 'edit') && (
        <FoodItemDialog
          key={dialog.type === 'edit' ? dialog.item.id : 'new'}
          item={dialog.type === 'edit' ? dialog.item : undefined}
          saving={addItem.isPending || editItem.isPending}
          saveError={saveError}
          onClose={() => setDialog(null)}
          onSave={(patch: FoodPatch) => {
            if (dialog.type === 'edit') {
              editItem.mutate(
                { id: dialog.item.id, patch },
                { onSuccess: () => setDialog(null) },
              )
            } else {
              addItem.mutate(patch, { onSuccess: () => setDialog(null) })
            }
          }}
          onDeleteFromLibrary={
            dialog.type === 'edit'
              ? () =>
                  setDialog({
                    type: 'delete',
                    item: dialog.item,
                    returnDialog: dialog,
                  })
              : undefined
          }
        />
      )}

      {dialog?.type === 'delete' && (
        <ConfirmDialog
          title="Delete from library"
          message={`This will remove "${dialog.item.name}" from your food library. This cannot be undone.`}
          confirmLabel="Delete"
          dangerous
          onCancel={() => setDialog(dialog.returnDialog ?? null)}
          onConfirm={() => {
            removeItem.mutate(dialog.item.id, { onSuccess: () => setDialog(null) })
          }}
        />
      )}

      {dialog?.type === 'import-explainer' && (
        <FoodImportExplainerDialog
          onClose={() => setDialog(null)}
          onContinue={() => {
            setDialog(null)
            openImportPicker()
          }}
        />
      )}

      {dialog?.type === 'import-error' && (
        <Modal open onClose={() => setDialog(null)} title="Import error" className="w-full max-w-sm">
          <div className="p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Import error</h2>
            <p className="text-sm text-red-600 mb-4">{dialog.message}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
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

      <MobileFoodActionBar
        onNewFood={() => setDialog({ type: 'create' })}
        onImport={() => setDialog({ type: 'import-explainer' })}
        onExport={handleExport}
        canExport={allItems.length > 0}
      />
    </div>
  )
}

// Import explainer: the gear import-explainer pattern carrying the old
// FoodCsvFormatDialog's content (canonical header + copy button + sample
// download), then Continue opens the file picker. One dialog instead of a
// separate format-help dialog so the format guidance sits exactly where the
// user needs it.
function FoodImportExplainerDialog({
  onClose,
  onContinue,
}: {
  onClose: () => void
  onContinue: () => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Modal open onClose={onClose} title="Import foods" className="w-full max-w-lg">
      <div className="p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-3">Import foods</h2>
        <p className="text-sm text-gray-600 mb-3">
          Adds foods directly to your library. Build your CSV with this header
          row (column order doesn&apos;t matter):
        </p>
        <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs whitespace-pre text-gray-800">
          {FOOD_CSV_HEADER}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(FOOD_CSV_HEADER)
                .then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
                .catch(() => {
                  // Clipboard unavailable (permissions / insecure context):
                  // the header stays visible for manual selection.
                })
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? (
              <>
                <Check size={14} className="text-green-600" /> Copied
              </>
            ) : (
              <>
                <Copy size={14} /> Copy header
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => downloadCsv('food-library-sample.csv', FOOD_SAMPLE_CSV)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download size={14} /> Download sample CSV
          </button>
        </div>
        <ul className="mt-4 mb-5 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            <span className="font-medium text-gray-700">Required:</span> name,
            serving_weight_grams, calories_per_serving.
          </li>
          <li>Blank optional fields import as unknown - never as 0.</li>
          <li>GearSkeptic CSVs also import; Grampacker exports use this header.</li>
        </ul>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <PrimaryButton type="button" onClick={onContinue}>
            Continue
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  )
}

function errorMessage(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ApiError) return err.message
  return 'Something went wrong. Please try again.'
}

function FoodTable({
  rows,
  unit,
  showMacros,
  sort,
  onSort,
  onEdit,
  onDelete,
}: {
  rows: FoodItem[]
  unit: 'g' | 'oz'
  showMacros: boolean
  sort: SortState
  onSort: (key: SortKey) => void
  onEdit: (item: FoodItem) => void
  onDelete: (item: FoodItem) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm" aria-label="Food library">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
            <SortHeader label="Name" active={sort.key === 'name'} dir={sort.dir} onClick={() => onSort('name')} />
            <th className="px-3 py-2 font-medium">Serving</th>
            <SortHeader label="Calories" active={sort.key === 'calories'} dir={sort.dir} onClick={() => onSort('calories')} align="right" />
            <SortHeader label="Density" active={sort.key === 'density'} dir={sort.dir} onClick={() => onSort('density')} align="right" />
            {showMacros && (
              <>
                <th className="px-3 py-2 text-right font-medium">Protein</th>
                <th className="px-3 py-2 text-right font-medium">Carbs</th>
                <th className="px-3 py-2 text-right font-medium">Fat</th>
                <th className="px-3 py-2 text-right font-medium">Fiber</th>
                <th className="px-3 py-2 text-right font-medium">Sodium</th>
                <th className="px-3 py-2 text-right font-medium">Potassium</th>
                <th className="px-3 py-2 text-right font-medium" title="Carbs-to-protein ratio">C:P</th>
              </>
            )}
            <th className="px-3 py-2 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((food) => (
            <tr key={food.id} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900" title={food.name}>
                  {food.name}
                </div>
                {food.brand && (
                  <div className="text-xs text-gray-500">{food.brand}</div>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {formatServingDescriptor(food, {
                  withWeight: true,
                  withCalories: false,
                  unit,
                })}
              </td>
              <td className={`px-3 py-2 text-right text-gray-700 ${NUMERIC_VALUE_TEXT}`}>
                {food.caloriesPerServing} kcal
              </td>
              <td className={`px-3 py-2 text-right text-gray-700 ${NUMERIC_VALUE_TEXT}`}>
                {formatCalorieDensity(calorieDensity(food), unit)}
              </td>
              {showMacros && (
                <>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatGrams(food.proteinGrams)}</td>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatGrams(food.carbsGrams)}</td>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatGrams(food.fatGrams)}</td>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatGrams(food.fiberGrams)}</td>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatMilligrams(food.sodiumMg)}</td>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatMilligrams(food.potassiumMg)}</td>
                  <td className={`px-3 py-2 text-right text-gray-600 ${NUMERIC_VALUE_TEXT}`}>{formatRatio(carbProteinRatio(food))}</td>
                </>
              )}
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => onEdit(food)}
                    aria-label={`Edit ${food.name}`}
                    className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(food)}
                    aria-label={`Delete ${food.name}`}
                    className="rounded p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FoodCardList({
  rows,
  unit,
  showMacros,
  onEdit,
  onDelete,
}: {
  rows: FoodItem[]
  unit: 'g' | 'oz'
  showMacros: boolean
  onEdit: (item: FoodItem) => void
  onDelete: (item: FoodItem) => void
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Food library">
      {rows.map((food) => (
        <li
          key={food.id}
          className="rounded-lg border border-gray-200 bg-white p-3"
        >
          <div className="flex items-start justify-between gap-2">
            {/* Tap the body to edit (matches the old food card + gear rows). */}
            <button
              type="button"
              onClick={() => onEdit(food)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate font-medium text-gray-900">
                {food.name}
              </div>
              <div className="truncate text-xs text-gray-500">
                {[
                  food.brand,
                  formatServingDescriptor(food, {
                    withWeight: true,
                    withCalories: false,
                    unit,
                  }),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </div>
              {showMacros && (
                <div className="mt-1 text-xs text-gray-500">
                  P {formatGrams(food.proteinGrams)} · C{' '}
                  {formatGrams(food.carbsGrams)} · F {formatGrams(food.fatGrams)}
                  {' · '}
                  {formatMilligrams(food.sodiumMg)} sodium
                </div>
              )}
            </button>
            <div className="flex flex-col items-end">
              <div className={`text-sm text-gray-700 ${NUMERIC_VALUE_TEXT}`}>
                {food.caloriesPerServing} kcal
              </div>
              <div className={`text-xs text-gray-500 ${NUMERIC_VALUE_TEXT}`}>
                {formatCalorieDensity(calorieDensity(food), unit)}
              </div>
              <button
                type="button"
                onClick={() => onDelete(food)}
                aria-label={`Delete ${food.name}`}
                className={`mt-1 shrink-0 text-gray-400 hover:bg-red-50 hover:text-red-600 ${ROW_CONTROL_TARGET}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-700"
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {active ? (dir === 'asc' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  )
}

function FoodLibraryEmptyState({
  onCreate,
  onImport,
}: {
  onCreate: () => void
  onImport: () => void
}) {
  return (
    <section className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-8 text-center">
      <h2 className="text-base font-semibold text-gray-900">No foods yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
        Add your first food or import a CSV to start building your library.
        You&apos;ll use these to build meal plans.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} />
          Add food
        </button>
        <button
          type="button"
          onClick={onImport}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Import CSV
        </button>
      </div>
    </section>
  )
}
