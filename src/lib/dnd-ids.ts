// Typed identifiers for dnd-kit's `id` property on sortables and droppables.
//
// dnd-kit accepts any string (or number) as an id. Without a convention, drag
// handlers infer "what is being dragged" by checking which collection the id
// belongs to (e.g. categoryIdSet.has(active.id)). UUID collision across tables
// is effectively impossible, so the inference is safe — but it forces every
// handler to know about every table that participates in DnD.
//
// We prefix every sortable id with its kind, parse on the way out:
//
//   useSortable({ id: makeDnDId('category', cat.id) })
//   ...
//   // dnd-kit's UniqueIdentifier is `string | number`; parseDnDId
//   // requires `string`, so wrap the active id at the call site.
//   const active = parseDnDId(String(event.active.id))
//   if (active?.kind === 'category') { ... }
//
// The kind tag does the work the inference used to: handlers branch on it
// directly, the type system narrows the surrounding code, and a cross-kind
// drop (drag a gear-item over a category header) bails cleanly via
// `active.kind !== over.kind` instead of relying on coincidence.
//
// Format is `<kind>:<uuid>`. The colon is the delimiter; uuids never contain
// colons so `indexOf(':')` is unambiguous. Numeric ids would need a different
// delimiter, but every id in this codebase is a uuid.

export type DnDIdKind = 'category' | 'gear-item' | 'item' | 'list-card'

export type DnDId = `${DnDIdKind}:${string}`

export function makeDnDId(kind: DnDIdKind, id: string): DnDId {
  return `${kind}:${id}`
}

export function parseDnDId(raw: string): { kind: DnDIdKind; id: string } | null {
  const idx = raw.indexOf(':')
  if (idx < 0) return null
  const kind = raw.slice(0, idx)
  const id = raw.slice(idx + 1)
  if (kind !== 'category' && kind !== 'gear-item' && kind !== 'item' && kind !== 'list-card') {
    return null
  }
  if (id.length === 0) return null
  return { kind, id }
}
