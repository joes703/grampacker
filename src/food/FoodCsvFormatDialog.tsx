import { useState } from 'react'
import { X, Copy, Check, Download } from 'lucide-react'
import { FOOD_CSV_HEADER, FOOD_SAMPLE_CSV, downloadCsv } from '../lib/csv'
import Modal from '../components/Modal'
import { ROW_CONTROL_TARGET } from '../components/flat-table-styles'

type Props = {
  onClose: () => void
}

// Lightweight help affordance for the Food library CSV import: shows the
// canonical header row (the single source of truth, FOOD_CSV_HEADER) so users
// can copy it before building a CSV, plus a small sample file that imports as
// realistic starter data.
export default function FoodCsvFormatDialog({ onClose }: Props) {
  const [copied, setCopied] = useState(false)

  return (
    <Modal
      open
      onClose={onClose}
      title="Food CSV format"
      className="w-[calc(100vw-2rem)] max-w-lg"
    >
      <div className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Food CSV format</h2>
          <button type="button" onClick={onClose} aria-label="Close" className={`${ROW_CONTROL_TARGET} text-gray-400 hover:text-gray-600`}>
            <X size={18} />
          </button>
        </div>

        <p className="mt-2 text-sm text-gray-600">
          Build your CSV with this header row (column order matters):
        </p>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-xs whitespace-pre text-gray-800">
          {FOOD_CSV_HEADER}
        </pre>

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(FOOD_CSV_HEADER)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                // Clipboard unavailable (permissions / insecure context): leave
                // the header visible so the user can select and copy manually.
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? (
              <><Check size={14} className="text-green-600" /> Copied</>
            ) : (
              <><Copy size={14} /> Copy header</>
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

        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>
            <span className="font-medium text-gray-700">Required:</span> name,
            serving_weight_grams, calories_per_serving.
          </li>
          <li>Blank optional fields import as unknown.</li>
          <li>Use the sample CSV if you want starter foods to edit or test with.</li>
          <li>GearSkeptic CSVs also import, but Grampacker exports use the canonical header.</li>
        </ul>
      </div>
    </Modal>
  )
}
