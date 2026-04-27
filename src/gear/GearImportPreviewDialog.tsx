import { X } from 'lucide-react'
import type { GearCsvRow } from '../lib/csv'
import { formatItemWeight } from '../lib/weight'
import Modal from '../components/Modal'

type Props = {
  rows: GearCsvRow[]
  saving: boolean
  onConfirm: (rows: GearCsvRow[]) => void
  onClose: () => void
}

export default function GearImportPreviewDialog({ rows, saving, onConfirm, onClose }: Props) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
      className="w-full max-w-lg flex flex-col max-h-[80vh]"
      closeOnBackdropClick={false}
    >
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">
          Import {rows.length} item{rows.length !== 1 ? 's' : ''}
        </h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">
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
                <td className="px-4 py-1.5 font-medium text-gray-900 max-w-[180px] truncate">{row.name}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatItemWeight(row.weight_grams, 'g')}</td>
                <td className="px-3 py-1.5 text-gray-500">{row.category || '—'}</td>
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
        <button
          type="button"
          onClick={() => onConfirm(rows)}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Importing…' : `Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </Modal>
  )
}
