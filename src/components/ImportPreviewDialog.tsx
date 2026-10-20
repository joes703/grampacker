import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatItemWeight } from '../lib/weight'
import Modal from './Modal'
import PrimaryButton from './PrimaryButton'
import { ROW_CONTROL_TARGET, SECONDARY_BUTTON } from './flat-table-styles'
import { MAX_DESC_LENGTH } from '../lib/caps'

// The one CSV import preview: header with title + notes + close, sticky-
// header Name/Weight/Category table, Cancel / "Import N item(s)" footer.
// The gear-library import and the list import used to carry near-identical
// copies of this whole dialog (and had already drifted: the gear copy lost
// its close button's ml-4). What genuinely differs comes in as props: the
// title suffix, the caller's note lines around the shared long-description
// warning, and the list import's extra Flags column.

// What every importable CSV row carries; the warning count reads description.
type BaseRow = {
  name: string
  weightGrams: number
  categoryName?: string | null
  description?: string | null
}

type Props<R extends BaseRow> = {
  rows: R[]
  // Appended to "Import N item(s)" in the title and heading ('' for gear,
  // ' into a new list' for the list import).
  titleSuffix?: string
  // Caller-specific note lines. The shared too-long-descriptions warning
  // renders between them, so a caller can keep its established ordering.
  notesAbove?: ReactNode
  notesBelow?: ReactNode
  // Optional trailing table column (the list import's Flags).
  extraColumn?: { header: string; cell: (row: R) => ReactNode }
  saving: boolean
  onConfirm: (rows: R[]) => void
  onClose: () => void
}

export default function ImportPreviewDialog<R extends BaseRow>({
  rows,
  titleSuffix = '',
  notesAbove,
  notesBelow,
  extraColumn,
  saving,
  onConfirm,
  onClose,
}: Props<R>) {
  const longDescriptionCount = rows.filter(
    (r) => (r.description?.length ?? 0) > MAX_DESC_LENGTH,
  ).length
  const title = `Import ${rows.length} item${rows.length !== 1 ? 's' : ''}${titleSuffix}`

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      className="w-full max-w-lg flex flex-col max-h-[80vh]"
      closeOnBackdropClick={false}
    >
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          {notesAbove}
          {longDescriptionCount > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {longDescriptionCount} description{longDescriptionCount === 1 ? '' : 's'} longer than {MAX_DESC_LENGTH.toLocaleString()} characters will be shortened on import.
            </p>
          )}
          {notesBelow}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={`${ROW_CONTROL_TARGET} ml-4 text-gray-500 hover:text-gray-600`}>
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
              {extraColumn && <th className="px-3 py-2 text-center">{extraColumn.header}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {/* Slightly narrower name cap when the extra column needs
                    the room - the widths both copies already used. */}
                <td className={`px-4 py-1.5 font-normal text-gray-900 ${extraColumn ? 'max-w-[160px]' : 'max-w-[180px]'} truncate`}>
                  {row.name}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{formatItemWeight(row.weightGrams, 'g')}</td>
                <td className="px-3 py-1.5 text-gray-500">{row.categoryName || '--'}</td>
                {extraColumn && (
                  <td className="px-3 py-1.5 text-center text-xs">{extraColumn.cell(row)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
          Cancel
        </button>
        <PrimaryButton type="button" onClick={() => onConfirm(rows)} disabled={saving}>
          {saving ? 'Importing…' : `Import ${rows.length} item${rows.length !== 1 ? 's' : ''}`}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
