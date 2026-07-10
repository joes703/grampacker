import { useState } from 'react'
import { Download } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  fetchLists,
  fetchListItems,
} from '../lib/queries'
import { buildTakeoutFiles, exportTimestamp } from '../lib/export/takeout-files'
import type { ListItemWithGear } from '../lib/types'

// "Download all data" control for the settings page: builds a zip client-
// side (gear library CSV + one CSV per list) and triggers a download. The
// pure file-map construction lives in ../lib/export/takeout-files so the
// bug-prone part is unit-tested without this component.
export default function DownloadAllData() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleDownload() {
    setBusy(true)
    setMsg(null)
    try {
      // Dynamic import: fflate (~20 KB gzipped) is only needed for this
      // handler, so a top-level import would charge every settings visit
      // for it. Kick the chunk fetch off in parallel with the data fetches
      // rather than awaiting it first - both are async, no reason to gate.
      const fflatePromise = import('fflate')
      const [fflate, categories, gearItems, lists] = await Promise.all([
        fflatePromise,
        qc.fetchQuery({ queryKey: queryKeys.categories(), queryFn: fetchCategories }),
        qc.fetchQuery({ queryKey: queryKeys.gearItems(), queryFn: fetchGearItems }),
        qc.fetchQuery({ queryKey: queryKeys.lists(), queryFn: fetchLists }),
      ])

      // Items for every list, fetched per list through the cache (a list
      // visited recently is already warm) and flattened. buildTakeoutFiles
      // regroups by listId. No bulk endpoint and no inArray, so no D1
      // param-limit exposure - the count of requests is the list count.
      const perList = await Promise.all(
        lists.map((l) =>
          qc.fetchQuery({
            queryKey: queryKeys.listItems(l.id),
            queryFn: () => fetchListItems(l.id),
          }),
        ),
      )
      const allItems: ListItemWithGear[] = perList.flat()

      const { zipSync, strToU8 } = fflate
      const fileContents = buildTakeoutFiles({ categories, gearItems, lists, allItems })
      const files: Record<string, Uint8Array> = {}
      for (const [name, content] of Object.entries(fileContents)) {
        files[name] = strToU8(content)
      }

      const zipped = zipSync(files)
      const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grampacker-export-${exportTimestamp()}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <Download size={14} />
        {busy ? 'Building zip...' : 'Download .zip'}
      </button>
      {msg && <p className="mt-2 text-sm text-rose-700">{msg}</p>}
    </div>
  )
}
