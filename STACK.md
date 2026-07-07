# Stack

Versions pinned exact at scaffold time (2026-07-07), verified against npm
dist-tags the same day. `npm ci` for CI/deploy installs; `.npmrc` sets
`ignore-scripts=true` (verified: install + dev + build all work under it).

## Installed at phase 0

| Package | Version | Why / notes |
| --- | --- | --- |
| hono | 4.12.28 | API framework. v4 line is the stable consensus; no v5 announced. |
| drizzle-orm | 1.0.0-rc.4 | ORM. Deliberate RC adoption to skip the 0.x -> 1.0 migration (decision 2026-07-07). v1 dropped the v0 `{ schema }` constructor config in favor of `relations`; wire it when tables land. |
| drizzle-kit | 1.0.0-rc.4 | Migration generator. Generate-only locally; `wrangler d1 migrations apply` applies. |
| zod | 4.4.3 | DTO schemas in `shared/`, validated on both sides of the API. |
| react / react-dom | 19.2.7 | Same major as the SPA being transplanted. |
| wrangler | 4.107.0 | Exactly matches @cloudflare/vite-plugin's peer floor (`^4.107.0`). |
| @cloudflare/vite-plugin | 1.43.0 | Runs the Worker inside Vite dev (workerd) - one `npm run dev` for SPA + API + local D1. |
| vite | 8.1.3 | Rolldown line. All plugins verified against `^8` peer ranges at scaffold. |
| @vitejs/plugin-react | 6.0.3 | Requires vite ^8. |
| tailwindcss + @tailwindcss/vite | 4.3.2 | CSS-first v4 config (`@import 'tailwindcss'`). |
| typescript | 6.0.3 | `tsc -b` over three noEmit projects (app / worker / node). TS 7 native compiler is trial-not-adopt. |
| vitest | 4.1.10 | v5 still beta (5.0.0-beta.6 at scaffold). No test runner on betas. |

## Arriving in later phases (pin at install time, re-verify dist-tags then)

- better-auth (1.6.23 at scaffold) - phase 1. Vercel acquisition watch item:
  pin versions, gate upgrades on Workers-pool integration tests.
- @cloudflare/vitest-pool-workers - phase 1, API integration tests against
  real workerd + D1. Verify its vitest peer range at install.
- @tanstack/react-query (5.101.2), react-router (8.1.0), lucide-react,
  @dnd-kit classic (core 6 / sortable 10 / utilities 3), react-markdown -
  phase 2+ with the SPA transplant.
- eslint (10.6.0) + typescript-eslint + the import-boundary rules - phase 1.
  eslint-plugin-jsx-a11y stays excluded until a release supports ESLint 10
  peers (same deferral as the old repo).

## Upgrade policy

- Exact pins, no ranges. Renovate/deps PRs bump deliberately.
- No core infra on beta/RC - drizzle 1.0.0-rc.4 is the single deliberate
  exception (recorded in REWRITE_PLAN.md section 12); move to 1.0.0 GA when
  it ships.
- Major bumps re-verify `rm -rf node_modules && npm ci` before merging
  (peer-dep failures fail closed; never --legacy-peer-deps).

## Watch list

- drizzle-orm/kit 1.0.0 GA (leave RC as soon as it exists)
- vitest 5 GA
- @dnd-kit/react 1.0 (classic line transplants until then)
- eslint-plugin-jsx-a11y with ESLint 10 peer support
- TypeScript 7 native compiler (trial on a branch when it GAs; adopt only if
  tsc -b semantics survive)
