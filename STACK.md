# Stack

**Reference, not policy.** `package.json` and the lockfile are authoritative
for versions.

**`package.json` and the lockfile are authoritative for versions.** This file
is not, and the table below has NOT been kept in step - by 2026-08-11 nearly
every number in it was behind (hono 4.12.28 documented vs 4.13.1 installed,
better-auth 1.6.23 vs 1.6.26, wrangler 4.107.0 vs 4.120.0, and several
"arriving later" entries that arrived). Duplicating a machine-readable fact in
prose guarantees the prose rots.

What is worth keeping here is CONTEXT - why a dependency sits where it does,
and what would move it. The rules themselves live in `AGENTS.md` ("Git and
supply chain"); this file restates none of them, because a rule in two places
is a rule that will disagree with itself.

- TypeScript sits on 6.x because typescript-eslint declares `<6.1.0` and
  throws at load on 7. 7.0 typechecks this repo cleanly, so the blocker is the
  linter's peer range, not the compiler.
- drizzle-orm sits on 0.45.x because better-auth peers on `^0.45.2`. The thing
  to watch is better-auth's peer range, not drizzle's releases.
- `overrides` exist here for transitive advisories rather than preference; see
  AGENTS.md for how they must be written.

## Installed at phase 0 - HISTORICAL

Everything below is the scaffold's own notes from 2026-07-07, preserved as a
record of why each dependency was chosen. **The versions are the scaffold's,
not today's, and any instruction-shaped sentence in it ("generate-only",
"pin at install time", "no core infra on beta/RC", "gate upgrades on...") is a
scaffold-era note, not a current rule.** `AGENTS.md` governs what you may do;
if a line here reads like policy, that is this section failing to sound as
historical as it is.

| Package | Version | Why / notes |
| --- | --- | --- |
| hono | 4.12.28 | API framework. v4 line is the stable consensus; no v5 announced. |
| drizzle-orm | 0.45.2 | ORM. Was 1.0.0-rc.4 for one day: better-auth peers on `^0.45.2` (even better-auth 1.7.0-rc.1 does), so the RC bet was reversed 2026-07-07 before any schema existed. Upgrade trigger: better-auth's peer range admitting drizzle 1.x - 1.0 will be GA by then. |
| drizzle-kit | 0.31.10 | Migration generator. Generate-only locally; `wrangler d1 migrations apply` applies. Carries the esbuild <=0.24.2 dev-server advisory (GHSA-67mh-4wv8-2f99) via its vendored config loader - accepted: dev-only CLI, never runs an esbuild serve process, nothing ships to production. |
| better-auth | 1.7.2 | Auth core: sessions, and the `magic-link` plugin (which ships INSIDE core - `better-auth/plugins/magic-link` - so passwordless auth added no dependency). Email/password was removed 2026-07-11; see `docs/passwordless-auth-design.md`. Vercel-acquisition watch item: gate upgrades on Workers-pool integration tests. 1.7 (landed via Dependabot #224) added a required `account.issuer` column plus a unique `(issuer, account_id)` index to better-auth's own model: the CLI-generated schema had to be regenerated and migration 0028 added the column, so expect a better-auth minor to need a schema regen + migration, not just a lockfile bump. |
| zod | 4.4.3 | DTO schemas in `shared/`, validated on both sides of the API. |
| react / react-dom | 19.2.7 | Same major as the SPA being transplanted. |
| wrangler | 4.129.0 | Exactly matches the wrangler version BOTH Cloudflare plugins pin as an exact dependency (not merely their peer range). Moving wrangler without moving both plugins to the release that pins the same version nests a second wrangler, miniflare and workerd under whichever plugin disagrees - the lockfile carried exactly that under vitest-pool-workers from 0.22.0 until the 2026-09 rename PR. |
| @cloudflare/vite-plugin | 1.54.4 | Runs the Worker inside Vite dev (workerd) - one `npm run dev` for SPA + API + local D1. Pins wrangler exactly (1.54.4 -> 4.129.0), so it moves in lockstep with wrangler and the Vitest plugin. |
| vite | 8.1.3 | Rolldown line. All plugins verified against `^8` peer ranges at scaffold. |
| @vitejs/plugin-react | 6.0.3 | Requires vite ^8. |
| tailwindcss + @tailwindcss/vite | 4.3.2 | CSS-first v4 config (`@import 'tailwindcss'`). |
| typescript | 6.0.3 | `tsc -b` over three noEmit projects (app / worker / node). TS 7 native compiler is trial-not-adopt. |
| vitest | 4.1.11 | v5 was still beta at scaffold (5.0.0-beta.6); 5.0.0 went GA 2026-09-03. Held on 4.1.x because `@cloudflare/vitest-plugin` peers on `vitest ^4.1.0` and no release accepts 5.x yet - the upgrade trigger is the plugin's peer range, not Vitest's release. |

## Installed during phase 1

| Package | Version | Why / notes |
| --- | --- | --- |
| @cloudflare/vitest-plugin | 1.1.4 | API integration tests against real workerd + D1 (peers vitest ^4.1.0). Installed as `@cloudflare/vitest-pool-workers` 0.18.1; Cloudflare renamed the package for its 1.0 release (2026-08-19) with the API unchanged, and the repo followed in 2026-09. 0.18 API, still current: `cloudflareTest()` Vite plugin (not `defineWorkersConfig`), `readD1Migrations` on the root export, types at the `/types` subpath, env is `Cloudflare.Env`. Pins wrangler and zod exactly; the zod pin (4.4.3) trails the app's zod, so one nested zod under this package is expected in the lockfile. |
| eslint | 10.6.0 | Baseline lint plus the security import boundary: fail-closed over all of server/ (data layer, middleware, composition root, and tests are the explicit exemptions) - no DB factory/schema, drizzle-orm, repo constructors, or auth imports; dynamic import() banned; eslint-disable comments neutralized via noInlineConfig. Runs inside `npm run build` (gates deploys) and in CI (gates merges). |
| typescript-eslint | 8.63.0 | Flat-config recommended rules + `@typescript-eslint/no-restricted-imports` (allowTypeImports keeps repo row-type imports legal in routes). |
| eslint-plugin-react-hooks | 7.1.1 | Hooks correctness for the SPA (`src/**`). eslint-plugin-jsx-a11y stays excluded until a release supports ESLint 10 peers (same deferral as the old repo). |
| react-router | 8.1.0 | Pulled forward from the phase-2 list: auth email links land on real URL paths, which needs a router. Now load-bearing for `/auth/magic` - the magic link points at the SPA rather than at better-auth's verify endpoint, so a mail scanner prefetching the URL cannot burn the single-use token. Declarative mode only. |
| @better-auth/passkey | 1.7.2 | WebAuthn passkeys, version-locked to better-auth (the plugin was extracted from core). Its table was NOT in the initial auth migration (an earlier note here claimed otherwise) - migration 0002 adds it via CLI regeneration. rpID derives from BETTER_AUTH_URL: grampacker.app for any *.grampacker.app host, so pre-cutover credentials survive the apex flip. |
| @tanstack/react-query | 5.101.2 | Phase 2: SPA cache/mutation layer, same major+minor the old app runs. Client defaults ported (30s staleTime, single retry, no focus refetch); the global mutation error handler arrives with the Toast system in the UI transplant. |

## Arriving in later phases (pin at install time, re-verify dist-tags then)

- lucide-react, @dnd-kit classic (core 6 / sortable 10 / utilities 3),
  react-markdown - with the gear UI transplant (phase 2 step 3) and later
  slices.

## Upgrade history

Context, not rules - `AGENTS.md` "Git and supply chain" is binding.

The only time a core dependency ran on a pre-release here was a one-day
drizzle RC in 2026-07-07, reversed the same day because better-auth's peer
range rejected it. That is the whole history; it is recorded because "we tried
it once and it failed for a specific reason" is more useful than a
prohibition.

## Watch list

- drizzle 1.x: the upgrade trigger is better-auth's peer range admitting it
  (GA will long since have shipped by then)
- vitest 5: GA shipped 2026-09-03 (5.0.0); blocked on `@cloudflare/vitest-plugin`
  publishing a release whose peer range admits it
- @dnd-kit/react 1.0 (classic line transplants until then)
- eslint-plugin-jsx-a11y with ESLint 10 peer support
- TypeScript 7 native compiler (trial on a branch when it GAs; adopt only if
  tsc -b semantics survive)
