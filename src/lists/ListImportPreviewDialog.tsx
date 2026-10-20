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
// worn/consumable Flags column.
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
          New items will be added to your gear library. Items already in the library won't be duplicated.
          {wornCount > 0 && ` ${wornCount} worn.`}
          {consumCount > 0 && ` ${consumCount} consumable.`}
        </p>
      }
      notesBelow={
        pricedCount > 0 ? (
          <p className="mt-1 text-xs text-gray-500">
            Prices apply only to newly added gear. Items already in your library keep the price you already set.
          </p>
        ) : undefined
      }
      extraColumn={{
        header: 'Flags',
        cell: (row) => (
          <>
            {row.isWorn && <span className="text-purple-600 mr-1">W</span>}
            {row.isConsumable && <span className="text-orange-600">C</span>}
          </>
        ),
      }}
      saving={saving}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  )
}
