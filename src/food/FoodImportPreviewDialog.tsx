import { X } from 'lucide-react'
import type { FoodImportRow } from '../lib/csv'
import type { FoodItemInput } from '../lib/queries'
import { FOOD_ITEM_CAP } from '../lib/caps'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'

type Props = {
  rows: FoodImportRow[]
  existingCount: number
  saving: boolean
  onConfirm: (items: FoodItemInput[]) => void
  onClose: () => void
}

export default function FoodImportPreviewDialog({
  rows, existingCount, saving, onConfirm, onClose,
}: Props) {
  const invalidCount = rows.filter((r) => r.errors.length > 0).length
  const validItems = rows.filter(
    (r): r is FoodImportRow & { item: FoodItemInput } => r.item !== null,
  )
  const wouldExceedCap = existingCount + rows.length > FOOD_ITEM_CAP
  const canImport = rows.length > 0 && invalidCount === 0 && !wouldExceedCap && !saving

  return (
    <Modal
      open
      onClose={onClose}
      title={`Import ${rows.length} food${rows.length !== 1 ? 's' : ''}`}
      className="w-full max-w-2xl flex flex-col max-h-[80vh]"
      closeOnBackdropClick={false}
    >
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">
          Import {rows.length} food{rows.length !== 1 ? 's' : ''}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className={`${ROW_CONTROL_TARGET} text-gray-400 hover:text-gray-600`}>
          <X size={18} />
        </button>
      </div>

      {(invalidCount > 0 || wouldExceedCap) && (
        <div className="px-6 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
          {invalidCount > 0 && (
            <p>
              {invalidCount} row{invalidCount !== 1 ? 's' : ''} need fixing before you can import.
              Fix them in your CSV and try again.
            </p>
          )}
          {wouldExceedCap && (
            <p>
              This import would exceed your food library limit ({FOOD_ITEM_CAP} max). You have{' '}
              {existingCount}.
            </p>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs font-medium text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Serving (g)</th>
              <th className="px-3 py-2 text-right">Cal</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => {
              const invalid = row.errors.length > 0
              return (
                <tr key={row.rowNumber} className={invalid ? 'bg-red-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-1.5 tabular-nums text-gray-400">{row.rowNumber}</td>
                  <td className="px-3 py-1.5 font-normal text-gray-900 max-w-[180px] truncate">{row.name || '--'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{row.item ? row.item.serving_weight_grams : '--'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{row.item ? row.item.calories_per_serving : '--'}</td>
                  <td className={`px-3 py-1.5 ${invalid ? 'text-red-700' : 'text-gray-400'}`}>
                    {invalid ? row.errors.join('; ') : 'OK'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </button>
        <PrimaryButton
          type="button"
          onClick={() => onConfirm(validItems.map((r) => r.item))}
          disabled={!canImport}
        >
          {saving ? 'Importing…' : `Import ${rows.length} food${rows.length !== 1 ? 's' : ''}`}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
