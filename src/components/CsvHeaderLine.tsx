import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { CSV_HEADER_LINE } from '../lib/csv'

// The first row for a hand-built CSV, with a Copy button. select-all is the
// fallback when the browser refuses the clipboard.
export default function CsvHeaderLine() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(CSV_HEADER_LINE)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable. The row is still on screen to select.
    }
  }

  return (
    <div className="mb-5">
      <p className="text-sm text-gray-600 mb-1">First row of a CSV:</p>
      <div className="flex items-start gap-2 rounded border border-gray-200 bg-gray-50 p-2">
        <code className="min-w-0 flex-1 select-all break-words text-xs text-gray-800">
          {CSV_HEADER_LINE}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
        >
          {copied ? (
            <><Check size={12} className="text-green-600" /> Copied</>
          ) : (
            <><Copy size={12} /> Copy</>
          )}
        </button>
      </div>
    </div>
  )
}
