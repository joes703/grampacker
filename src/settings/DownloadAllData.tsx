import { useState } from 'react'
import { Download } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  fetchLists,
  fetchListItems,
  fetchFoodItems,
  fetchFoodPlans,
  fetchFoodPlan,
} from '../lib/queries'
import { buildTakeoutFiles, exportTimestamp } from '../lib/export/takeout-files'
import type { FoodPlanDocument } from '../lib/queries'
import type { ListItemWithGear } from '../lib/types'

// "Download all data" control for the settings page: builds a zip client-
// side (gear library CSV + one CSV per list + food library CSV + the
// food-data.json plan snapshot) and triggers a download. The pure file-map
// construction lives in ../lib/export/takeout-files so the bug-prone part
// is unit-tested without this component.
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
      // staleTime: 0 on every takeout read: an export is a snapshot claim,
      // so it must hit the server rather than reuse anything the app's
      // 30-second staleTime still considers fresh - another tab or device
      // may have written since this tab's cache filled (Codex finding).
      // Successful results still land in the cache for the app to reuse.
      const [fflate, categories, gearItems, lists, foodItems, planSummaries] =
        await Promise.all([
          fflatePromise,
          qc.fetchQuery({ queryKey: queryKeys.categories(), queryFn: fetchCategories, staleTime: 0 }),
          qc.fetchQuery({ queryKey: queryKeys.gearItems(), queryFn: fetchGearItems, staleTime: 0 }),
          qc.fetchQuery({ queryKey: queryKeys.lists(), queryFn: fetchLists, staleTime: 0 }),
          qc.fetchQuery({ queryKey: queryKeys.foodItems(), queryFn: fetchFoodItems, staleTime: 0 }),
          qc.fetchQuery({ queryKey: queryKeys.foodPlans(), queryFn: fetchFoodPlans, staleTime: 0 }),
        ])

      // Items for every list, fetched per list and flattened;
      // buildTakeoutFiles regroups by listId. No bulk endpoint and no
      // inArray, so no D1 param-limit exposure - the count of requests is
      // the list count. Food plans follow the same per-entity pattern: one
      // document fetch per plan (request count = plan count, capped at 100).
      const [perList, foodPlans] = await Promise.all([
        Promise.all(
          lists.map((l) =>
            qc.fetchQuery({
              queryKey: queryKeys.listItems(l.id),
              queryFn: () => fetchListItems(l.id),
              staleTime: 0,
            }),
          ),
        ),
        Promise.all(
          planSummaries.map(
            (p): Promise<FoodPlanDocument> =>
              qc.fetchQuery({
                queryKey: queryKeys.foodPlan(p.id),
                queryFn: () => fetchFoodPlan(p.id),
                staleTime: 0,
              }),
          ),
        ),
      ])
      const allItems: ListItemWithGear[] = perList.flat()

      const { zipSync, strToU8 } = fflate
      const fileContents = buildTakeoutFiles({
        categories,
        gearItems,
        lists,
        allItems,
        foodItems,
        foodPlans,
      })
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
