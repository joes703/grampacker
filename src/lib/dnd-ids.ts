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

// Single source of truth for DnD kinds. The `as const` tuple gives us both
// a runtime list (used by `parseDnDId`'s validation) and a derived type
// union (`DnDIdKind`), so adding a new kind requires one edit instead of
// two. Deliberately NOT exported — only the type is — to keep the surface
// minimal and prevent callers from importing the runtime tuple directly.
const DND_KINDS = ['category', 'gear-item', 'item', 'list-card'] as const

export type DnDIdKind = (typeof DND_KINDS)[number]

export type DnDId = `${DnDIdKind}:${string}`

// Real typeguard: a cast inside `.includes(kind as DnDIdKind)` would NOT
// narrow `kind` for the subsequent `return { kind, id }` — it would only
// satisfy `.includes`'s argument type. With a `kind is DnDIdKind` predicate,
// TS narrows `kind` along the success branch and the return shape continues
// to type-check. The `(DND_KINDS as readonly string[])` cast inside widens
// the tuple's element type so `.includes(kind)` accepts an arbitrary
// `string` (without it, `.includes` requires a `DnDIdKind` argument and
// rejects the wider input).
function isDnDIdKind(kind: string): kind is DnDIdKind {
  return (DND_KINDS as readonly string[]).includes(kind)
}

export function makeDnDId(kind: DnDIdKind, id: string): DnDId {
  return `${kind}:${id}`
}

export function parseDnDId(raw: string): { kind: DnDIdKind; id: string } | null {
  const idx = raw.indexOf(':')
  if (idx < 0) return null
  const kind = raw.slice(0, idx)
  const id = raw.slice(idx + 1)
  if (!isDnDIdKind(kind)) return null
  if (id.length === 0) return null
  return { kind, id }
}
