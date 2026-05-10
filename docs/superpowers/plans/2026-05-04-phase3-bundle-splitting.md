# Phase 3 — bundle splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Defer four eager-imported, cold/rare-path modules (`fflate`, `vaul`, `react-markdown`, auth + SharePage routes) into async chunks via four atomic commits, capturing the gzip-size delta in each commit message.

**Architecture:** Each commit is independent — H6 (fflate dynamic import inside one handler), H5 (`React.lazy` mobile drawer in `ListSelector`), H4 (`React.lazy` `MarkdownPage` from About + Help), L7 (`React.lazy` auth pages + SharePage in `routes.tsx`). H5 is scoped to `ListSelector` only — the `ListDetailPage` sidebar drawer is `lg:hidden`-only and needs M11's JS viewport gate, deferred.

**Tech Stack:** Vite, Rollup, React.lazy / Suspense, dynamic `await import()`.

**Baseline (pre-Phase 3):** `dist/assets/index-BhBzxqpA.js` = **909.76 KB raw / 261.02 KB gzip**.

---

## Task 1: Commit 1 — Dynamic-import fflate in SettingsPage (H6)

**Files:**
- Modify: `src/settings/SettingsPage.tsx`

- [ ] **Step 1.1: Capture before-size**

Run: `npm run build 2>&1 | grep -E "dist/assets/index.*js"`
Record the gzip number for the index chunk.

- [ ] **Step 1.2: Remove the static fflate import**

In `src/settings/SettingsPage.tsx`, delete the line:
```ts
import { zipSync, strToU8 } from 'fflate'
```

- [ ] **Step 1.3: Add dynamic import inside handleDownload**

Inside `handleDownload` (around the existing `if (!session) return` / `setBusy(true)` block), add as the first line of the `try` block:

```ts
const { zipSync, strToU8 } = await import('fflate')
```

Place it before `Promise.all([...])` so the chunk fetch races against the data fetches.

- [ ] **Step 1.4: Build to verify chunk split + size delta**

Run: `npm run build 2>&1 | grep "dist/assets" | sort -k 2 -h`
Expected:
- Build succeeds.
- A new chunk file appears containing `fflate`.
- Main `index-*.js` gzip drops ~15–25 KB.

- [ ] **Step 1.5: Run tests**

Run: `npm test -- --run`
Expected: 23/23 pass (no settings tests, but typecheck must hold).

- [ ] **Step 1.6: Commit**

Use the recorded before/after gzip numbers in the message:

```bash
git add src/settings/SettingsPage.tsx
git commit -m "$(cat <<'EOF'
perf(bundle): dynamic-import fflate in SettingsPage download handler (H6)

fflate (~20 KB gzipped) is used in exactly one place — the "Download all
data" handler in Settings. Top-level static import meant every authed
user paid for it on initial load even though most never click download.
Moved to `await import('fflate')` inside the handler so the chunk fetch
defers to click time.

Main bundle gzip: BEFORE → AFTER (-N KB).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Commit 2 — Lazy-load mobile drawer in ListSelector (H5, narrowed)

**Files:**
- Create: `src/layout/ListSelectorDrawer.tsx`
- Modify: `src/layout/ListSelector.tsx`

**Mental model:** the existing `ListSelector.tsx` already gates the mobile drawer render on a `useIsMobile()` hook (or equivalent). The fix: extract the entire `<Drawer.Root>...</Drawer.Root>` block into its own file with a default export, then `React.lazy` import it from `ListSelector.tsx`. With the JS gate already present, desktop users genuinely never load the chunk.

**Pre-flight:** read `src/layout/ListSelector.tsx` end-to-end. Confirm:
- The mobile branch is gated on a JS condition (e.g. `if (isMobile) return <drawer>` or `{isMobile && <drawer>}`).
- The drawer block uses props that can be passed as a new component's prop interface (don't reach back into outer-scope state via closures — convert closures into props).

If the existing `useIsMobile()` gate is missing, **STOP and surface as a blocker** — adding a JS viewport gate would be M11 scope.

- [ ] **Step 2.1: Read ListSelector.tsx fully**

Read `src/layout/ListSelector.tsx`. Identify:
- All values referenced inside the `<Drawer.Root>...</Drawer.Root>` block (props, state, callbacks).
- The current `useIsMobile()` gate location.

- [ ] **Step 2.2: Create `src/layout/ListSelectorDrawer.tsx`**

The new file:
- Imports `Drawer` from `vaul` (this is the only file in the eager graph that imports vaul once L7 is wired).
- Exports a default-exported component whose props are the union of every value the original drawer block referenced.
- Renders the `<Drawer.Root>...</Drawer.Root>` block verbatim, with closure references converted to prop reads.

**Important:** the prop interface should be inferrable from the original call site — if the drawer reads `lists`, `currentListId`, `onSelect`, `onCreateNew`, `open`, `onOpenChange` — those become the props. Match types exactly to what `ListSelector` currently has typed.

- [ ] **Step 2.3: Update `ListSelector.tsx` to lazy-load**

At the top of `ListSelector.tsx`:
1. Remove `import { Drawer } from 'vaul'`.
2. Add `import { lazy, Suspense } from 'react'` (extending the existing react import).
3. Add `const ListSelectorDrawer = lazy(() => import('./ListSelectorDrawer'))`.

In the JSX, replace the inline `<Drawer.Root>...</Drawer.Root>` block with:

```tsx
<Suspense fallback={null}>
  <ListSelectorDrawer
    open={...}
    onOpenChange={...}
    {...other props matched to the new component}
  />
</Suspense>
```

The mobile gate (e.g. `isMobile && ...`) stays where it was — wraps the lazy render the same way it wrapped the inline drawer.

- [ ] **Step 2.4: Build to verify**

Run: `npm run build 2>&1 | grep "dist/assets" | sort -k 2 -h`
Expected:
- Build succeeds.
- A new chunk appears containing `vaul` (gzip ~8–18 KB).
- Main `index-*.js` gzip drops by a similar amount.

- [ ] **Step 2.5: Run tests**

Run: `npm test -- --run`
Expected: 23/23 pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/layout/ListSelectorDrawer.tsx src/layout/ListSelector.tsx
git commit -m "$(cat <<'EOF'
perf(bundle): lazy-load mobile drawer in ListSelector (H5)

vaul (~15-20 KB gzipped) is mobile-only but ListSelector mounts on every
authed route via NavBar, so desktop users paid for it on every page.
ListSelector already gates the drawer render on a JS viewport check,
so React.lazy-ing the drawer body genuinely defers the chunk on desktop.

Extracted the <Drawer.Root> block into ListSelectorDrawer.tsx with a
clean prop interface, lazy-imported from ListSelector with a null
Suspense fallback (the drawer IS the mobile UI; no useful fallback).

Scoped narrowly to ListSelector. ListDetailPage's sidebar drawer is
also vaul but hidden via lg:hidden CSS only — adding a JS gate there
belongs to M11 (render-perf cluster), deferred.

Main bundle gzip: BEFORE → AFTER (-N KB).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Commit 3 — Lazy-load MarkdownPage from About and Help (H4)

**Files:**
- Modify: `src/about/AboutPage.tsx`
- Modify: `src/help/HelpPage.tsx`

**Mental model:** both consumers import `MarkdownPage` eagerly. Vite chunks together by import graph — a single `lazy(() => import('../components/MarkdownPage'))` written in TWO files generates ONE shared async chunk because the resolver dedupes by specifier. So both routes still trigger the same chunk on first visit, then it's cached.

- [ ] **Step 3.1: Read AboutPage.tsx and HelpPage.tsx**

Confirm both files import `MarkdownPage` at the top and render `<MarkdownPage content={...} />`.

- [ ] **Step 3.2: Convert AboutPage.tsx**

At the top of `src/about/AboutPage.tsx`:

Remove:
```ts
import MarkdownPage from '../components/MarkdownPage'
```

Add (preserving any existing `react` import — extend if needed):
```ts
import { lazy, Suspense } from 'react'

const MarkdownPage = lazy(() => import('../components/MarkdownPage'))
```

Wrap the existing `<MarkdownPage content={aboutContent} />` JSX with:

```tsx
<Suspense fallback={null}>
  <MarkdownPage content={aboutContent} />
</Suspense>
```

- [ ] **Step 3.3: Convert HelpPage.tsx**

Same shape:

```tsx
import { lazy, Suspense } from 'react'
// (preserve other existing imports)
import helpContent from './help.md?raw'  // or whatever the existing content import is

const MarkdownPage = lazy(() => import('../components/MarkdownPage'))

export default function HelpPage() {
  return (
    <Suspense fallback={null}>
      <MarkdownPage content={helpContent} />
    </Suspense>
  )
}
```

Don't touch `MarkdownPage.tsx` itself — its SAFETY header comment from Phase 1 stays intact.

- [ ] **Step 3.4: Build to verify**

Run: `npm run build 2>&1 | grep "dist/assets" | sort -k 2 -h`
Expected:
- Build succeeds.
- A new chunk appears containing `react-markdown` and `remark-gfm` (~50–80 KB gzip — likely the largest delta of all four commits).
- Main `index-*.js` gzip drops by ~45–80 KB.

- [ ] **Step 3.5: Run tests**

Run: `npm test -- --run`
Expected: 23/23 pass.

- [ ] **Step 3.6: Commit**

```bash
git add src/about/AboutPage.tsx src/help/HelpPage.tsx
git commit -m "$(cat <<'EOF'
perf(bundle): lazy-load MarkdownPage on About and Help routes (H4)

react-markdown + remark-gfm + the unified/mdast pipeline is the largest
single eager dep at ~60-80 KB gzipped, used only on /about and /help
(both static markdown 95% of users never visit). Moved to React.lazy
in both consumers. Vite dedupes the import specifier so both routes
share one async chunk.

Suspense fallback is null — these routes have negligible above-the-fold
content; a brief blank flash on the rare visit is acceptable. A skeleton
can be a follow-up if usability reports surface a problem.

MarkdownPage.tsx itself is untouched (Phase 1's SAFETY guard comment stays).

Main bundle gzip: BEFORE → AFTER (-N KB).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Commit 4 — Code-split auth pages and SharePage (L7)

**Files:**
- Modify: `src/routes.tsx`

- [ ] **Step 4.1: Convert all five eager imports to lazy**

Replace the contents of `src/routes.tsx` with:

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
        {/* Public — readable without a session. AboutPage owns its own
            chrome (auth-aware mini-header) since it sits outside AppShell. */}
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

`AppShell` and `AboutPage` stay eager. AppShell is the post-login destination for every authed user (no win); AboutPage was scoped out by the audit and AboutPage's Markdown content is already lazy-loaded after Commit 3.

- [ ] **Step 4.2: Build to verify**

Run: `npm run build 2>&1 | grep "dist/assets" | sort -k 2 -h`
Expected:
- Build succeeds.
- New chunks for the auth pages and SharePage appear (small individually).
- Main `index-*.js` gzip drops modestly (5–15 KB).

- [ ] **Step 4.3: Run tests**

Run: `npm test -- --run`
Expected: 23/23 pass.

- [ ] **Step 4.4: Commit**

```bash
git add src/routes.tsx
git commit -m "$(cat <<'EOF'
perf(bundle): code-split auth pages and SharePage (L7)

LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage are reachable
only by unauthed visitors; SharePage is for unauthed share-link viewers.
None load alongside the authed app. Eager imports meant authed users still
paid for the auth-page bundle on every initial load. Moved to React.lazy
with a single Suspense boundary wrapping the Routes.

AppShell stays eager (post-login destination for every authed user — lazy
would just add a chunk hop with no win). AboutPage stays eager; its
heavy dep (react-markdown) is already lazy after H4.

Main bundle gzip: BEFORE → AFTER (-N KB).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Append Phase 3 summary to REVIEW-FIX.md

**Files:**
- Modify: `.planning/REVIEW-FIX.md`

- [ ] **Step 5.1: Append Phase 3 section**

Append below the existing Phase 2 section:

```markdown

---

## Phase 3 — bundle splitting (2026-05-04)

### Shipped
- Commit 1 (H6) — `<hash>` — fflate dynamic-import in SettingsPage. Gzip: 261.02 KB → AFTER (-N KB).
- Commit 2 (H5) — `<hash>` — vaul lazy-load in ListSelector. Gzip: BEFORE → AFTER (-N KB).
- Commit 3 (H4) — `<hash>` — react-markdown lazy-load on About/Help. Gzip: BEFORE → AFTER (-N KB).
- Commit 4 (L7) — `<hash>` — auth pages + SharePage code-split. Gzip: BEFORE → AFTER (-N KB).

Cumulative gzip delta: -N KB (-X% off baseline).

### Verification results
- `npm run build`: pass after each commit, with N new async chunks visible.
- `npm test --run`: 23/23 pass.
- Manual smoke (download zip, mobile drawer, /about + /help, auth routes, /r/:slug): **pending user verification**.

### Blockers / surprises
- (fill in or "none")

### Next phase
Phase 4: tbd — likely render-perf cluster (M6, M7, M8, M11, M12) or DB indexes (H1, M1).
```

Replace `<hash>` and BEFORE/AFTER/N placeholders with the actual numbers from each commit's run.

- [ ] **Step 5.2: Commit**

```bash
git add .planning/REVIEW-FIX.md
git commit -m "$(cat <<'EOF'
docs(review-fix): append Phase 3 summary

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review against the locked spec

**Spec coverage:** all four commits map 1:1 to REVIEW-PHASE3.md's commits. Out-of-scope items (ListDetailPage drawer carry-over, lucide tree-shaking re-check, inner-route splits) explicitly held.

**Type consistency:** `lazy`, `Suspense` imports added via `react` in each touched file. No new types introduced.

**Manual smoke acknowledgment:** all four commits flagged manual-smoke pending; build-size delta is the automated gate.
