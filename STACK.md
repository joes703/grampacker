# Stack

**Reference, not policy.** `package.json` and the lockfile are authoritative
for versions.

**`package.json` and the lockfile are authoritative for versions.** This file
is not, and the table below has NOT been kept in step - by 2026-08-11 nearly
every number in it was behind (hono 4.12.28 documented vs 4.13.1 installed,
better-auth 1.6.23 vs 1.6.26, wrangler 4.107.0 vs 4.120.0, and several
"arriving later" entries that arrived). Duplicating a machine-readable fact in
prose guarantees the prose rots.

What is worth keeping here is the RATIONALE - why a dependency is pinned where
it is, what would trigger moving it, and which constraints are non-obvious:

- Direct dependencies are pinned exact: `.npmrc` sets `save-exact`. `npm ci`
  for CI and deploy installs; `ignore-scripts=true` (verified: install, dev
  and build all work under it - re-test a clean `npm ci` + build before ever
  removing it).
- **`overrides` are the exception and must be RANGES** tracking their parent.
  Dependabot does not update overrides, so an exact pin there rots silently.
- TypeScript stays on 6.x: 7.0 typechecks this repo cleanly but
  typescript-eslint declares `<6.1.0` and throws at load. Move when its peer
  range admits 7.
- drizzle-orm stays on 0.45.x: better-auth peers on `^0.45.2`. Upgrade trigger
  is better-auth's peer range admitting drizzle 1.x.

## Installed at phase 0 (HISTORICAL - versions here are the scaffold's, not today's)

| Package | Version | Why / notes |
| --- | --- | --- |
| hono | 4.12.28 | API framework. v4 line is the stable consensus; no v5 announced. |
| drizzle-orm | 0.45.2 | ORM. Was 1.0.0-rc.4 for one day: better-auth peers on `^0.45.2` (even better-auth 1.7.0-rc.1 does), so the RC bet was reversed 2026-07-07 before any schema existed. Upgrade trigger: better-auth's peer range admitting drizzle 1.x - 1.0 will be GA by then. |
| drizzle-kit | 0.31.10 | Migration generator. Generate-only locally; `wrangler d1 migrations apply` applies. Carries the esbuild <=0.24.2 dev-server advisory (GHSA-67mh-4wv8-2f99) via its vendored config loader - accepted: dev-only CLI, never runs an esbuild serve process, nothing ships to production. |
| better-auth | 1.6.23 | Auth core: sessions, and the `magic-link` plugin (which ships INSIDE core - `better-auth/plugins/magic-link` - so passwordless auth added no dependency). Email/password was removed 2026-07-11; see `docs/passwordless-auth-design.md`. Vercel-acquisition watch item: gate upgrades on Workers-pool integration tests. |
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
| react-router | 8.1.0 | Pulled forward from the phase-2 list: auth email links land on real URL paths, which needs a router. Now load-bearing for `/auth/magic` - the magic link points at the SPA rather than at better-auth's verify endpoint, so a mail scanner prefetching the URL cannot burn the single-use token. Declarative mode only. |
| @better-auth/passkey | 1.6.23 | WebAuthn passkeys, version-locked to better-auth (the plugin was extracted from core). Its table was NOT in the initial auth migration (an earlier note here claimed otherwise) - migration 0002 adds it via CLI regeneration. rpID derives from BETTER_AUTH_URL: grampacker.app for any *.grampacker.app host, so pre-cutover credentials survive the apex flip. |
| @tanstack/react-query | 5.101.2 | Phase 2: SPA cache/mutation layer, same major+minor the old app runs. Client defaults ported (30s staleTime, single retry, no focus refetch); the global mutation error handler arrives with the Toast system in the UI transplant. |

## Arriving in later phases (pin at install time, re-verify dist-tags then)

- lucide-react, @dnd-kit classic (core 6 / sortable 10 / utilities 3),
  react-markdown - with the gear UI transplant (phase 2 step 3) and later
  slices.

## Upgrade notes

**Not policy.** `AGENTS.md` "Git and supply chain" is binding; if these ever
disagree, AGENTS.md wins and this file is the bug. What follows is context
specific to this dependency set, not rules:

- No core infra on beta/RC. The one-day drizzle RC experiment (adopted and
  reversed 2026-07-07 when better-auth's peer range rejected it) is the only
  time that was tried, and it was reversed because better-auth's peer range
  rejected it rather than on principle.
- A major bump is worth a clean `rm -rf node_modules && npm ci` before
  merging: peer-dep failures fail closed, which is the point of not reaching
  for `--legacy-peer-deps`.

## Watch list

- drizzle 1.x: the upgrade trigger is better-auth's peer range admitting it
  (GA will long since have shipped by then)
- vitest 5 GA
- @dnd-kit/react 1.0 (classic line transplants until then)
- eslint-plugin-jsx-a11y with ESLint 10 peer support
- TypeScript 7 native compiler (trial on a branch when it GAs; adopt only if
  tsc -b semantics survive)
