import { describe, expect, it } from 'vitest'

// SharePage is the PUBLIC, READ-ONLY share view. It cannot drag anything, so it
// has no business downloading a drag-and-drop library - and for a long time it
// did, because SortableItemRow lived inside ItemRow.tsx and CategoryGroup
// imported SortableContext to branch on a `sortable` boolean. A boolean cannot
// hide an import from the bundler: @dnd-kit came along for the ride, 15.8 kB
// gzipped, to a page that renders nothing draggable.
//
// The fix (SortableItemRow.tsx + SortableCategoryRows.tsx, injected through
// CategoryGroup's `renderRows` prop) is only a fix for as long as nobody adds
// the import back. A comment does not enforce that. This does: it walks the
// REAL static import graph out of SharePage and fails if @dnd-kit is anywhere in
// it - which is the same question the bundler asks.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Static imports only. A DYNAMIC import (the markdown renderer, say) is by
// definition a separate chunk and not on the first-paint path, so it is not what
// this is about - and following it would make the test assert something the
// bundler does not.
const STATIC_IMPORT = /^\s*import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/gm

function resolve(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const dir = fromFile.slice(0, fromFile.lastIndexOf('/'))
  const parts = `${dir}/${spec}`.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  const base = `/${out.join('/')}`
  // Vite resolves the extension; the glob keys have it.
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (candidate in sources) return candidate
  }
  return null
}

/** Every module SharePage statically pulls in, transitively. */
function staticGraphFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const code = sources[file]
    if (code === undefined) continue
    for (const [, clause, spec] of code.matchAll(STATIC_IMPORT)) {
      if (spec === undefined) continue
      // `import type { X } from '...'` is erased at build; it costs no bytes and
      // cannot drag a runtime dependency in. ItemRow relies on exactly this to
      // keep a @dnd-kit TYPE without the library.
      if (clause?.trimStart().startsWith('type ')) continue
      const resolved = resolve(file, spec)
      if (resolved) queue.push(resolved)
    }
  }
  return seen
}

function dndValueImports(file: string): string[] {
  const code = sources[file] ?? ''
  return [...code.matchAll(STATIC_IMPORT)]
    .filter(
      ([, clause, spec]) =>
        spec !== undefined &&
        spec.startsWith('@dnd-kit') &&
        !clause?.trimStart().startsWith('type '),
    )
    .map(([line]) => line.trim())
}

describe('the public share view', () => {
  it('reaches its own module graph', () => {
    // Guard the guard: if the glob or the resolver broke, every assertion below
    // would pass vacuously on an empty set.
    const graph = staticGraphFrom('/src/lists/SharePage.tsx')
    expect(graph.has('/src/lists/CategoryGroup.tsx')).toBe(true)
    expect(graph.has('/src/lists/ItemRow.tsx')).toBe(true)
    expect(graph.size).toBeGreaterThan(10)
  })

  it('never pulls @dnd-kit into a read-only page', () => {
    const offenders = [...staticGraphFrom('/src/lists/SharePage.tsx')]
      .map((file) => [file, dndValueImports(file)] as const)
      .filter(([, imports]) => imports.length > 0)
      .map(([file, imports]) => `${file}: ${imports.join(', ')}`)

    // If this fails: the drag code belongs in SortableItemRow.tsx /
    // SortableCategoryRows.tsx, which reach CategoryGroup through its
    // `renderRows` prop. Injecting it is what keeps the import edge - and so the
    // library - off the anonymous path.
    expect(offenders).toEqual([])
  })

  it('still lets the authenticated list view have its drag machinery', () => {
    // The other half of the invariant. If this ever goes green-by-emptiness, the
    // test above is passing because drag was deleted, not because it was moved.
    expect(dndValueImports('/src/lists/SortableItemRow.tsx').length).toBeGreaterThan(0)
    expect(dndValueImports('/src/lists/SortableCategoryRows.tsx').length).toBeGreaterThan(0)
  })
})
