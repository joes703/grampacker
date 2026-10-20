import type { QueryClient, QueryKey } from '@tanstack/react-query'

// FIELD-SCOPED optimistic cache access: the snapshot/apply/restore primitive
// behind the per-list caches whose rows are written concurrently (list items
// and food, with their Packed/Ready ticks, moves and resets).
//
// Why not makeOptimisticUpdate: its rollback restores the WHOLE array as it
// was at onMutate, undoing any other write that landed in the meantime, even
// one the server already saved - fail Packed while Ready succeeds on the same
// row and the Ready tick vanishes. Here the snapshot holds only the fields
// one write touches, and a rollback restores only those fields onto the
// CURRENT row, so concurrent writes compose with no mutex.
//
// Deliberately NOT owned here, because the five lifecycles genuinely differ:
// invalidation policy (updateItem's last-one-out gate vs invalidate-on-settle
// vs the resets' two-cache finally), promise ownership, and error reporting
// (which failures toast, and with what copy). Each caller keeps its own.
//
// `CacheShape` is how one primitive serves both cache layouts: list items are
// a bare row array, list food is a document holding an items array next to
// metadata (dayCount, slots) that every write must pass through untouched.

export type CacheShape<TData, TRow> = {
  rows: (data: TData) => TRow[]
  // Must return the SAME document with only the rows replaced - dropping or
  // recomputing the metadata here would make every optimistic food write
  // corrupt dayCount/slots until the settled refetch.
  withRows: (data: TData, rows: TRow[]) => TData
}

// The identity shape for caches that are a bare row array.
export function arrayShape<TRow>(): CacheShape<TRow[], TRow> {
  return {
    rows: (data) => data,
    withRows: (_data, rows) => rows,
  }
}

export function fieldScopedCache<TData, TRow extends { id: string }>(
  qc: QueryClient,
  queryKey: QueryKey,
  shape: CacheShape<TData, TRow>,
) {
  // Shape-preserving row map. An ABSENT cache is left absent (never seeded:
  // writing a row would flip `data` to defined, the signal every page reads
  // as "the fetch resolved" - see makeOptimisticInsert in optimistic.ts).
  const mapRows = (map: (row: TRow) => TRow) =>
    qc.setQueryData<TData>(queryKey, (curr) =>
      curr === undefined ? curr : shape.withRows(curr, shape.rows(curr).map(map)),
    )

  const getRows = () => {
    const data = qc.getQueryData<TData>(queryKey)
    return data === undefined ? undefined : shape.rows(data)
  }

  return {
    // Awaited cancel, like the shared helpers in optimistic.ts: an unawaited
    // cancel lets an in-flight refetch resolve after the optimistic write and
    // clobber it with stale server state.
    cancel: () => qc.cancelQueries({ queryKey }),
    getRows,
    mapRows,

    // cancel + snapshot + apply for ONE row. Returns the previous values of
    // the fields the patch names (skipping keys passed as undefined), or
    // undefined when the cache or the row is absent - in which case nothing
    // was applied and there is nothing to restore.
    async patchRow(
      rowId: string,
      patch: Partial<TRow>,
    ): Promise<Partial<TRow> | undefined> {
      await qc.cancelQueries({ queryKey })
      const row = getRows()?.find((r) => r.id === rowId)
      if (!row) return undefined
      const prevFields: Partial<TRow> = {}
      for (const k of Object.keys(patch) as (keyof TRow)[]) {
        if (patch[k] !== undefined) prevFields[k] = row[k]
      }
      mapRows((r) => (r.id === rowId ? { ...r, ...patch } : r))
      return prevFields
    },

    // Restore ONLY the snapshotted fields, onto the row as it is NOW.
    restoreRow(rowId: string, prevFields: Partial<TRow>) {
      mapRows((r) => (r.id === rowId ? { ...r, ...prevFields } : r))
    },
  }
}

export type FieldScopedCache<TData, TRow extends { id: string }> = ReturnType<
  typeof fieldScopedCache<TData, TRow>
>
