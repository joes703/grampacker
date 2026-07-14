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
// import graph out of SharePage - our modules, statically and lazily reachable -
// and fails if @dnd-kit is anywhere in it.
const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Static imports AND re-exports. `export { x } from './y'` is an import edge
// too: a barrel that re-exported the drag modules would pull @dnd-kit onto this
// path just as surely as an import would, and a matcher that only looked for the
// word "import" would never see it.
//
// Dynamic imports are followed too (DYNAMIC_EDGE below). An earlier version of
// this comment waved them off as "a separate chunk, not on the first-paint
// path", which is false: a separate chunk can be requested the instant a route
// renders, and SharePage's own lazy MarkdownContent is exactly that. The
// invariant worth having is not "not in the first chunk" but the plain one:
// nothing the share view can EVER load has any business with drag-and-drop.
//
// [^;()=] in the clause, NOT [\s\S], and that is the whole correctness of this
// matcher. An import clause spans lines but never contains `;`, `(` or `=`:
// `import a, { b as c, type D } from 'x'` is the widest it gets. Let the clause
// match anything and it runs THROUGH the statement it started on, hunting for
// the next `from '...'` anywhere in the file - so `export type Props = {` would
// swallow the whole module and capture some later import's specifier, with a
// bogus clause starting "type " that the type-skip below then throws away. The
// edge vanishes. This test shipped with exactly that bug and passed anyway,
// which is why the mutation checks below are not optional.
const STATIC_EDGE = /^\s*(?:import|export)\s+(?:([^;()=]*?)\s+from\s+)?['"]([^'"]+)['"]/gm

// `lazy(() => import('./X'))` and friends.
const DYNAMIC_EDGE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

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

/**
 * Every module in THIS repo that SharePage can reach, statically or lazily.
 *
 * Scope, stated honestly: it walks our own src/ modules. A third-party package
 * that itself depended on @dnd-kit would be invisible to it - that is a question
 * for the emitted bundle, and the bundle was checked by hand when this landed
 * (@dnd-kit strings appear in the AuthenticatedApp chunk and nowhere else). What
 * this catches is the regression that actually happens: someone adds an import
 * to one of OUR modules on this path.
 */
function graphFrom(entry: string): Set<string> {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const code = sources[file]
    if (code === undefined) continue

    for (const [, clause, spec] of code.matchAll(STATIC_EDGE)) {
      if (spec === undefined) continue
      // `import type { X } from '...'` is erased at build; it costs no bytes and
      // cannot drag a runtime dependency in. ItemRow relies on exactly this to
      // keep a @dnd-kit TYPE without the library.
      if (clause?.trimStart().startsWith('type ')) continue
      const resolved = resolve(file, spec)
      if (resolved) queue.push(resolved)
    }

    for (const [, spec] of code.matchAll(DYNAMIC_EDGE)) {
      if (spec === undefined) continue
      const resolved = resolve(file, spec)
      if (resolved) queue.push(resolved)
    }
  }
  return seen
}

function dndValueImports(file: string): string[] {
  const code = sources[file] ?? ''
  return [...code.matchAll(STATIC_EDGE)]
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
    const graph = graphFrom('/src/lists/SharePage.tsx')
    expect(graph.has('/src/lists/CategoryGroup.tsx')).toBe(true)
    expect(graph.has('/src/lists/ItemRow.tsx')).toBe(true)
    expect(graph.size).toBeGreaterThan(10)

    // flat-table-styles is reachable ONLY through a multi-line import clause
    // (ItemRow's `import {\n  FLAT_TABLE_BODY_TEXT,\n ...\n} from`). The clause
    // pattern is deliberately restrictive, so this pins the other edge of it: it
    // must still cross newlines, or the walk quietly stops seeing most of the
    // app and the whole test goes green by blindness.
    expect(graph.has('/src/components/flat-table-styles.ts')).toBe(true)

    // And the lazy edge: MarkdownContent is reachable from SharePage ONLY
    // through `lazy(() => import(...))`. A separate chunk is not a deferred one
    // - it is requested as soon as the route renders it - so it is inside the
    // invariant, not outside it.
    expect(graph.has('/src/components/MarkdownContent.tsx')).toBe(true)
  })

  it('never pulls @dnd-kit into a read-only page', () => {
    const offenders = [...graphFrom('/src/lists/SharePage.tsx')]
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

