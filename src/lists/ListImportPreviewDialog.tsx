import type { ListCsvRow } from '../lib/csv'
import ImportPreviewDialog from '../components/ImportPreviewDialog'

type Props = {
  rows: ListCsvRow[]
  saving: boolean
  onConfirm: (rows: ListCsvRow[]) => void
  onClose: () => void
}

// The list-import flavor of the shared ImportPreviewDialog: the
// into-a-new-list title, the library-dedup and price notes, and the
// quantity and worn/consumable Flags columns.
export default function ListImportPreviewDialog({ rows, saving, onConfirm, onClose }: Props) {
  const wornCount = rows.filter((r) => r.isWorn).length
  const consumCount = rows.filter((r) => r.isConsumable).length
  // Only surfaced when the file actually carries prices - a Lighterpack
  // export without them should not raise a question the user doesn't have.
  const pricedCount = rows.filter((r) => r.cost !== null).length

  return (
    <ImportPreviewDialog
      rows={rows}
      titleSuffix=" into a new list"
      notesAbove={
        <p className="text-xs text-gray-500 mt-0.5">
          Each item is added to your gear, unless your gear already has an
          item with the same name, category and weight.
          {wornCount > 0 && ` ${wornCount} worn.`}
          {consumCount > 0 && ` ${consumCount} consumable.`}
        </p>
      }
      notesBelow={
        pricedCount > 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            Prices are imported only for new gear. Gear you already have keeps
            its price.
          </p>
        ) : undefined
      }
      extraColumns={[
        {
          header: 'Qty',
          cell: (row) => (
            <span
              aria-label={row.quantityUnreadable ? `${row.name} quantity, could not be read` : undefined}
              className={`tabular-nums ${row.quantityUnreadable ? 'font-medium text-red-600' : 'text-gray-600'}`}
            >
              {row.quantity}
            </span>
          ),
        },
        {
          header: 'Flags',
          cell: (row) => (
            <>
              {row.isWorn && <span className="text-purple-600 mr-1">W</span>}
              {row.isConsumable && <span className="text-orange-600">C</span>}
            </>
          ),
        },
      ]}
      saving={saving}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
