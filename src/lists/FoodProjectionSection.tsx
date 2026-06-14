import { Link } from 'react-router'
import { AlertTriangle } from 'lucide-react'
import TotalWeightValue from '../components/TotalWeightValue'
import {
  FLAT_TABLE_BODY_TEXT,
  FLAT_TABLE_BODY_TEXT_MUTED,
  FLAT_TABLE_HEADER,
  FLAT_TABLE_HEADER_COUNT,
  FLAT_TABLE_HEADER_PADDING,
  FLAT_TABLE_HEADER_TITLE,
  FLAT_TABLE_META_TEXT,
  FLAT_TABLE_NUMERIC_TEXT,
  FLAT_TABLE_ROW,
  FLAT_TABLE_ROW_PADDING,
  FLAT_TABLE_SURFACE,
} from '../components/flat-table-styles'
import { useWeightUnit } from '../lib/use-weight-unit'
import PackModeCheckbox from './PackModeCheckbox'

export type FoodProjectionDisplayRow =
  | {
      foodItemId: string
      state: 'complete'
      name: string
      brand: string | null
      servingsLabel: string
      weightGrams: number
      packed: boolean
      packable: boolean
    }
  | {
      foodItemId: string
      state: 'incomplete'
      name: string
      brand: string | null
      reason: 'missing-food' | 'missing-metadata'
    }

type Props = {
  listId: string
  packMode: boolean
  showUnpackedOnly: boolean
  rows: FoodProjectionDisplayRow[]
  onTogglePacked: (foodItemId: string, next: boolean) => void
}

function incompleteLabel(reason: FoodProjectionDisplayRow & { state: 'incomplete' }): string {
  return reason.reason === 'missing-food' ? 'Missing food definition' : 'Missing packaging info'
}

export default function FoodProjectionSection({
  listId,
  packMode,
  showUnpackedOnly,
  rows,
  onTogglePacked,
}: Props) {
  const { weightUnit } = useWeightUnit()
  const visibleRows = packMode && showUnpackedOnly
    ? rows.filter((r) => r.state === 'incomplete' || !r.packed)
    : rows

  if (visibleRows.length === 0) return null

  const rowCount = rows.length

  return (
    <section className={FLAT_TABLE_SURFACE} aria-label="Food carried from plan">
      <div className={`${FLAT_TABLE_HEADER} ${FLAT_TABLE_HEADER_PADDING} justify-between gap-3`}>
        <div className="min-w-0">
          <span className={FLAT_TABLE_HEADER_TITLE}>Food from plan</span>
          <span className={`ml-2 ${FLAT_TABLE_HEADER_COUNT}`}>
            {rowCount} food{rowCount === 1 ? '' : 's'}
          </span>
        </div>
        <Link to={`/lists/${listId}/food`} className="shrink-0 text-xs font-medium text-blue-600 hover:underline">
          Edit food plan
        </Link>
      </div>

      <div>
        {visibleRows.map((row) => (
          <div key={row.foodItemId} className={`${FLAT_TABLE_ROW} ${FLAT_TABLE_ROW_PADDING} gap-2 bg-white`}>
            {packMode ? (
              <PackModeCheckbox
                variant="packed"
                checked={row.state === 'complete' ? row.packed : false}
                disabled={row.state === 'incomplete' || !row.packable}
                onChange={(checked) => onTogglePacked(row.foodItemId, checked)}
                ariaLabel={`Pack ${row.name}`}
                title={row.state === 'incomplete' ? incompleteLabel(row) : undefined}
                standaloneLabel
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className={`${FLAT_TABLE_BODY_TEXT} truncate text-gray-900`}>
                {row.name}
              </div>
              {row.brand ? (
                <div className={`${FLAT_TABLE_BODY_TEXT_MUTED} truncate`}>
                  {row.brand}
                </div>
              ) : null}
            </div>
            {row.state === 'complete' ? (
              <>
                <div className={`${FLAT_TABLE_META_TEXT} hidden text-right text-gray-500 sm:block`}>
                  {row.servingsLabel}
                </div>
                <div className={`${FLAT_TABLE_NUMERIC_TEXT} min-w-20 text-right text-gray-700`}>
                  <TotalWeightValue grams={row.weightGrams} unit={weightUnit} />
                </div>
              </>
            ) : (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                <AlertTriangle size={13} />
                {incompleteLabel(row)}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
