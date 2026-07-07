# Stack

Versions pinned exact at scaffold time (2026-07-07), verified against npm
dist-tags the same day. `npm ci` for CI/deploy installs; `.npmrc` sets
`ignore-scripts=true` (verified: install + dev + build all work under it).

## Installed at phase 0

| Package | Version | Why / notes |
| --- | --- | --- |
| hono | 4.12.28 | API framework. v4 line is the stable consensus; no v5 announced. |
| drizzle-orm | 0.45.2 | ORM. Was 1.0.0-rc.4 for one day: better-auth peers on `^0.45.2` (even better-auth 1.7.0-rc.1 does), so the RC bet was reversed 2026-07-07 before any schema existed. Upgrade trigger: better-auth's peer range admitting drizzle 1.x - 1.0 will be GA by then. |
| drizzle-kit | 0.31.10 | Migration generator. Generate-only locally; `wrangler d1 migrations apply` applies. Carries the esbuild <=0.24.2 dev-server advisory (GHSA-67mh-4wv8-2f99) via its vendored config loader - accepted: dev-only CLI, never runs an esbuild serve process, nothing ships to production. |
| better-auth | 1.6.23 | Auth core (email/password, sessions, email verification). Vercel-acquisition watch item: gate upgrades on Workers-pool integration tests. |
| zod | 4.4.3 | DTO schemas in `shared/`, validated on both sides of the API. |
| react / react-dom | 19.2.7 | Same major as the SPA being transplanted. |
| wrangler | 4.107.0 | Exactly matches @cloudflare/vite-plugin's peer floor (`^4.107.0`). |
| @cloudflare/vite-plugin | 1.43.0 | Runs the Worker inside Vite dev (workerd) - one `npm run dev` for SPA + API + local D1. |
| vite | 8.1.3 | Rolldown line. All plugins verified against `^8` peer ranges at scaffold. |
| @vitejs/plugin-react | 6.0.3 | Requires vite ^8. |
| tailwindcss + @tailwindcss/vite | 4.3.2 | CSS-first v4 config (`@import 'tailwindcss'`). |
| typescript | 6.0.3 | `tsc -b` over three noEmit projects (app / worker / node). TS 7 native compiler is trial-not-adopt. |
| vitest | 4.1.10 | v5 still beta (5.0.0-beta.6 at scaffold). No test runner on betas. |

## Installed during phase 1

| Package | Version | Why / notes |
| --- | --- | --- |
| @cloudflare/vitest-pool-workers | 0.18.1 | API integration tests against real workerd + D1 (peers vitest ^4.1.0). 0.18 API: `cloudflareTest()` Vite plugin (not `defineWorkersConfig`), types at the `/types` subpath, env is `Cloudflare.Env`. |
| eslint | 10.6.0 | Baseline lint plus the security import boundary: fail-closed over all of server/ (data layer, middleware, composition root, and tests are the explicit exemptions) - no DB factory/schema, drizzle-orm, repo constructors, or auth imports; dynamic import() banned; eslint-disable comments neutralized via noInlineConfig. Runs inside `npm run build` (gates deploys) and in CI (gates merges). |
| typescript-eslint | 8.63.0 | Flat-config recommended rules + `@typescript-eslint/no-restricted-imports` (allowTypeImports keeps repo row-type imports legal in routes). |
| eslint-plugin-react-hooks | 7.1.1 | Hooks correctness for the SPA (`src/**`). eslint-plugin-jsx-a11y stays excluded until a release supports ESLint 10 peers (same deferral as the old repo). |

## Arriving in later phases (pin at install time, re-verify dist-tags then)

- @better-auth/passkey (1.6.23, version-locked to better-auth; the plugin
  was extracted from core) - later in phase 1, after password sessions
  prove out. Its table is already in the initial auth migration.
- @tanstack/react-query (5.101.2), react-router (8.1.0), lucide-react,
  @dnd-kit classic (core 6 / sortable 10 / utilities 3), react-markdown -
  phase 2+ with the SPA transplant.

## Upgrade policy

- Exact pins, no ranges. Renovate/deps PRs bump deliberately.
- No core infra on beta/RC. No exceptions remain: the one-day drizzle RC
  experiment (adopted and reversed 2026-07-07 when better-auth's peer range
  rejected it) is recorded in REWRITE_PLAN.md section 13.
- Major bumps re-verify `rm -rf node_modules && npm ci` before merging
  (peer-dep failures fail closed; never --legacy-peer-deps).

## Watch list

- drizzle 1.x: the upgrade trigger is better-auth's peer range admitting it
  (GA will long since have shipped by then)
- vitest 5 GA
- @dnd-kit/react 1.0 (classic line transplants until then)
- eslint-plugin-jsx-a11y with ESLint 10 peer support
- TypeScript 7 native compiler (trial on a branch when it GAs; adopt only if
  tsc -b semantics survive)
