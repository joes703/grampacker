import { X } from 'lucide-react'
import type { GearCsvRow } from '../lib/csv'
import { formatItemWeight } from '../lib/weight'
import Modal from '../components/Modal'
import PrimaryButton from '../components/PrimaryButton'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'
import { MAX_DESC_LENGTH } from '../lib/caps'

type Props = {
  rows: GearCsvRow[]
  saving: boolean
  onConfirm: (rows: GearCsvRow[]) => void
  onClose: () => void
}

export default function GearImportPreviewDialog({ rows, saving, onConfirm, onClose }: Props) {
  const longDescriptionCount = rows.filter((r) => (r.description?.length ?? 0) > MAX_DESC_LENGTH).length

  return (
    <Modal
      open
      onClose={onClose}
      title={`Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
      className="w-full max-w-lg flex flex-col max-h-[80vh]"
      closeOnBackdropClick={false}
    >
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">
            Import {rows.length} item{rows.length !== 1 ? 's' : ''}
          </h2>
          {longDescriptionCount > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {longDescriptionCount} description{longDescriptionCount === 1 ? '' : 's'} longer than {MAX_DESC_LENGTH.toLocaleString()} characters will be shortened on import.
            </p>
          )}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={`${ROW_CONTROL_TARGET} text-gray-500 hover:text-gray-600`}>
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs font-medium text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2 text-left">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-1.5 font-normal text-gray-900 max-w-[180px] truncate">{row.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatItemWeight(row.weightGrams, 'g')}</td>
                <td className="px-3 py-1.5 text-gray-500">{row.categoryName || '--'}</td>
              </tr>
            ))}
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
          onClick={() => onConfirm(rows)}
          disabled={saving}
        >
          {saving ? 'Importing…' : `Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
