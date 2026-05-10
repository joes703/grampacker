# grampacker — Phase 3 fixes (2026-05-04)

**Source:** synthesized from `REVIEW-performance.md`.
**Scope:** the bundle-splitting cluster — four audit findings (H6, H5, H4, L7), each an independent lazy-import fix, shipped as **four atomic commits**.
**Why this is one phase:** all four findings are the same shape — eagerly-imported modules used on cold/rare paths that should ship in async chunks. They share the same mental model and the same verification (build-size delta), so bundling them keeps the per-fix overhead low.

> **Note on file paths:** all paths are repo-relative.
> **Baseline:** `dist/assets/index-BhBzxqpA.js` = **909.76 KB raw / 261.02 KB gzip** (pre-Phase-3, single bundle).

---

## How to execute this file

Four commits, **independent** — they can be done in any order, but the recommended order below puts the smallest, most isolated change first (H6) and the most tree-shake-sensitive change last (H4 — `react-markdown`'s deep transitive graph occasionally fights chunkers).

For each commit:
1. Capture the build size BEFORE the change (`npm run build` and read the gzip number for the index chunk).
2. Make the change exactly as specified.
3. Run `npm run build` and confirm:
   - Build succeeds.
   - The expected new chunk file appears in `dist/assets/`.
   - The main `index-*.js` chunk shrinks by roughly the audit's expected delta (allow ±20% — minifier rounding, shared deps).
4. Run existing tests (`npm test --run`) and confirm green.
5. Commit with a message that includes the **before/after gzip sizes** so the deltas are auditable from `git log`.
6. Move to the next commit.

After all four: append to `REVIEW-FIX.md` with one row per commit and the cumulative gzip delta.

---

## Commit 1 — Dynamic-import `fflate` inside SettingsPage download handler (H6)

**Origin:** REVIEW-performance.md H6 (High).

**Why:** `fflate` is ~20 KB gzipped and is used in exactly one place — the "Download all data" handler in `SettingsPage.tsx`. Today it's a top-level static import, so every authed user pays for it on initial page load even though most never click the download button. A dynamic import inside the handler defers the cost to the click.

**File:** `src/settings/SettingsPage.tsx`

**Change:**

Remove the top-level import:

```ts
import { zipSync, strToU8 } from 'fflate'
```

Inside the `handleDownload` function (around line 192), add as the first line:

```ts
const { zipSync, strToU8 } = await import('fflate')
```

Place it before the `Promise.all([...])` call so the chunk fetch can race against the data fetches.

**Verification:**
- `npm run build` succeeds.
- A new chunk appears (e.g. `dist/assets/fflate-*.js` or a hashed chunk containing fflate).
- Main `index-*.js` gzip drops by ~15–25 KB.

**Acceptance criteria:** the static `fflate` import is gone, the dynamic import is inside `handleDownload`, build passes, main chunk shrinks.

**Suggested commit:** `perf(bundle): dynamic-import fflate in SettingsPage download handler (H6)`

---

## Commit 2 — Lazy-load the mobile drawer in ListSelector (H5, narrowed)

**Origin:** REVIEW-performance.md H5 (High).

**Why:** `vaul` is ~15–20 KB gzipped and is mobile-only. Today it's statically imported by `ListSelector.tsx`, which mounts on every authed route via `NavBar`. Desktop users pay for it even though they never see the drawer. `ListSelector` already gates the drawer render on a `useIsMobile()` hook, so a `React.lazy` wrapper genuinely defers the chunk fetch on desktop.

**Scope decision:** ONLY `ListSelector.tsx`. `ListDetailPage.tsx` also imports `vaul` for its sidebar drawer, but that drawer is hidden via `lg:hidden` CSS (not a JS render gate), so lazy-loading it without adding `useIsMobile()` still mounts the lazy component on desktop and triggers the chunk fetch. Adding a JS gate there belongs to the M11 render-perf cluster (a future phase). Don't expand scope.

**File:** `src/layout/ListSelector.tsx`

**Approach:** extract the `<Drawer.Root>...</Drawer.Root>` block (lines 131–160) into a new file `src/layout/ListSelectorDrawer.tsx` with a default export, then `React.lazy` it from `ListSelector.tsx`. Keep all the same props (open, onOpenChange, list, onSelect, onCreateNew, etc. — match the existing call site). Wrap the lazy render in `<Suspense fallback={null}>` since the drawer is the entire mobile UI for this surface and a fallback would be visually noisy.

**Verification:**
- `npm run build` succeeds.
- A new chunk appears containing `vaul`.
- Main `index-*.js` gzip drops by ~10–18 KB.
- Manual smoke: on a mobile viewport, opening the list selector still works (drawer slides in, items render, dismiss works). **Pending user verification** — the build can't catch this.

**Important:** do NOT touch `ListDetailPage.tsx`'s sidebar drawer in this commit. That's M11 + future H5 carry-over.

**Acceptance criteria:** `vaul` import moved out of the eagerly-loaded module graph for `ListSelector`, build smaller, mobile drawer still works (smoke pending).

**Suggested commit:** `perf(bundle): lazy-load mobile drawer in ListSelector (H5)`

---

## Commit 3 — Lazy-load `MarkdownPage` from AboutPage and HelpPage (H4)

**Origin:** REVIEW-performance.md H4 (High).

**Why:** `react-markdown` + `remark-gfm` + `unified` + `mdast-util-*` is ~60–80 KB gzipped — the largest single eager dep that's used on cold/rare paths only. The two consumers (`AboutPage` and `HelpPage`) render static markdown that 95% of users never visit. Lazy-loading the consumer component moves the entire markdown stack into an async chunk.

**Approach:** `React.lazy` `MarkdownPage` itself in both consuming files.

**File 1:** `src/about/AboutPage.tsx`

Replace:

```ts
import MarkdownPage from '../components/MarkdownPage'
```

with:

```ts
import { lazy, Suspense } from 'react'

const MarkdownPage = lazy(() => import('../components/MarkdownPage'))
```

Wrap the `<MarkdownPage content={...} />` render in `<Suspense fallback={null}>`. (If the file imports `Suspense` already through some other path, dedupe.)

**File 2:** `src/help/HelpPage.tsx`

Same pattern:

```ts
import { lazy, Suspense } from 'react'

const MarkdownPage = lazy(() => import('../components/MarkdownPage'))

export default function HelpPage() {
  return (
    <Suspense fallback={null}>
      <MarkdownPage content={helpContent} />
    </Suspense>
  )
}
```

**Important:**
- Both consumers must use the same lazy-loaded module reference. Vite chunks together by import graph, so a single `import('../components/MarkdownPage')` in two files generates ONE shared async chunk — both routes load it on first visit, then it's cached.
- Do NOT touch `MarkdownPage.tsx` itself. Its SAFETY header comment from Phase 1 stays.
- Don't add a Suspense fallback that flashes — `null` is correct here. The Help and About pages have negligible above-the-fold content; a brief blank flash on the rare visit is acceptable. If the user reports a perceived delay, a skeleton can be a follow-up.

**Verification:**
- `npm run build` succeeds.
- A new chunk appears containing `react-markdown` (likely the largest delta of the four).
- Main `index-*.js` gzip drops by ~45–80 KB.
- Manual smoke: `/about` and `/help` still render correctly. **Pending user verification.**

**Acceptance criteria:** main bundle no longer contains `react-markdown`, both consumer routes still render, build is smaller.

**Suggested commit:** `perf(bundle): lazy-load MarkdownPage on About and Help routes (H4)`

---

## Commit 4 — Code-split auth pages and SharePage (L7)

**Origin:** REVIEW-performance.md L7 (Low).

**Why:** auth pages (`LoginPage`, `SignupPage`, `ForgotPasswordPage`, `ResetPasswordPage`) and `SharePage` are reachable only by unauthed visitors and never load alongside the authed app. Today `routes.tsx` imports them all eagerly, so authed users still pay for the auth-page bundle on initial load (and unauthed visitors pay for the share-page bundle). Smaller individually than H4/H5/H6 but real.

**File:** `src/routes.tsx`

**Change:** convert all five eager imports to `React.lazy`. Wrap the `<Routes>` in (or each Route element with) `<Suspense fallback={null}>`. Don't touch `AppShell` or `AboutPage` — `AppShell` is the post-login destination for every authed user (no win) and `AboutPage` was scoped out by the audit's L7 wording.

The cleanest shape:

```tsx
import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router'
import { useAuth } from './auth/AuthProvider'
import AppShell from './layout/AppShell'
import AboutPage from './about/AboutPage'

const LoginPage = lazy(() => import('./auth/LoginPage'))
const SignupPage = lazy(() => import('./auth/SignupPage'))
const ForgotPasswordPage = lazy(() => import('./auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./auth/ResetPasswordPage'))
const SharePage = lazy(() => import('./lists/SharePage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return null
  return session ? <>{children}</> : <Navigate to="/login" replace />
}

export default function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<SignupPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/r/:slug" element={<SharePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route
          path="/*"
          element={
            <PrivateRoute>
              <AppShell />
            </PrivateRoute>
          }
        />
      </Routes>
    </Suspense>
  )
}
```

**Important:**
- A single `<Suspense>` wrapping `<Routes>` is sufficient — React route transitions through a lazy boundary trigger Suspense once per navigation.
- `AppShell` stays eager. Every authed user lands inside it; lazy-loading would just add a chunk hop with no win.
- `AboutPage` stays eager per the audit's scoping. A future phase can revisit if its surface grows.

**Verification:**
- `npm run build` succeeds.
- New chunks appear for the auth pages and SharePage.
- Main bundle gzip drops modestly (5–15 KB — auth pages share a lot with the app shell).
- Manual smoke: navigate to `/login`, `/register`, `/forgot-password`, `/reset-password`, and a real `/r/:slug` link. All render. **Pending user verification.**

**Acceptance criteria:** all five routes lazy-loaded, build smaller, all routes still render (smoke pending).

**Suggested commit:** `perf(bundle): code-split auth pages and SharePage (L7)`

---

## Out of scope for Phase 3

These items appear in the audits or were discussed but are explicitly NOT part of this phase:

- **`ListDetailPage` sidebar drawer (H5 carry-over).** Needs a JS-side `useIsMobile()` gate, which belongs to the M11 render-perf cluster.
- **Inner AppShell route splitting (Settings, Lists, Gear, Help).** Audit's L7 scoped narrowly to auth + SharePage; broader splits are a future phase and need careful Suspense fallback design (these routes have above-the-fold content where a `null` fallback would flash unacceptably).
- **`lucide-react` per-icon imports (M13).** Verify-first item; audit notes "verify by inspecting `dist/assets/index-*.js` size; if it's bloated, switch to per-icon paths." After Phase 3, re-check whether lucide-react is still a meaningful share of the main chunk and decide.
- **All render-perf items (M6, M7, M8, M11, M12, L1, L2, L9)** — Phase 4 or 5.
- **All test gaps T-2 through T-9** — Phase 7. (T-7 partially closed by Phase 2's optimistic helper tests.)
- **Database indexes (H1, M1)** — separate phase, requires a migration.

If something looks like it requires expanding scope mid-commit, **stop and surface it** in the `REVIEW-FIX.md` summary as a "blocker" rather than expanding scope.

---

## Final summary

After all four commits land, append to `REVIEW-FIX.md` with this structure:

```markdown
## Phase 3 — bundle splitting (DATE)

### Shipped
- Commit 1 (H6): commit <hash> — fflate dynamic-import in SettingsPage. Gzip: <before> → <after> (-N KB).
- Commit 2 (H5): commit <hash> — vaul lazy-load in ListSelector. Gzip: <before> → <after> (-N KB).
- Commit 3 (H4): commit <hash> — react-markdown lazy-load on About/Help. Gzip: <before> → <after> (-N KB).
- Commit 4 (L7): commit <hash> — auth pages + SharePage code-split. Gzip: <before> → <after> (-N KB).

Cumulative gzip delta: -N KB (-X% off baseline).

### Verification results
- npm run build: pass after each commit, with new async chunks visible.
- npm test --run: 23/23 pass.
- Manual smoke (download zip, mobile drawer, /about + /help, auth routes, /r/:slug): pending user verification.

### Blockers / surprises
- (none, or list anything that surfaced)

### Next phase
Phase 4: tbd — likely render-perf cluster (M6, M7, M8, M11, M12) or DB indexes (H1, M1).
```

That's the deliverable. Four atomic commits, four async chunks, the audit's largest single eager dep (`react-markdown`) deferred from the main bundle, and per-commit gzip deltas captured in `git log` for future audit.
