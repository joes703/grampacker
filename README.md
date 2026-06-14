# grampacker

A backpacking gear list, weight tracker, and packing tool. Build trip-specific lists from your gear inventory, track packed and ready items, and calculate base, worn, consumable, and total pack weight.

Live at <https://grampacker.app>. Personal project, free to use.

## Features

- Maintain a reusable gear inventory and build trip-specific packing lists.
- Track packed and ready items in Pack mode.
- Share read-only public lists and mark unfinished lists as drafts.
- Import Lighterpack-compatible CSV files and export list or gear data.
- Install the app as a PWA and sign in with a password or passkey.

## Stack

TypeScript, React 19, Vite, Tailwind CSS 4, TanStack Query, Supabase (Postgres, Auth, and RLS), and Cloudflare Pages.

## Run locally

Requires Node.js 24.

```sh
cp .env.example .env
npm ci
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`. Use a Supabase publishable key, never a secret or service-role key.

## Verify

```sh
npm run security:check
npm run lint
npm run build
npm test -- --run
```

`npm run build` runs `tsc -b && vite build`. The security check covers the lockfile, known vulnerabilities, package signatures, and supply-chain indicators.

## Database

Database migrations live in `supabase/migrations/`. Generate and apply them through the Supabase CLI so local and linked migration history stays in sync. Review linked changes with `supabase db push --linked --dry-run` before applying them.

## Docs

- **`CLAUDE.md`**: agent instructions, verification rules, and implementation conventions.
- **`DECISIONS.md`**: architectural and product decisions.
- **`SPEC.md`**: current application behavior, limits, data rules, and security patterns.
- **`SECURITY.md`**: authentication, RLS, public sharing, and security assumptions.
- **`ADMIN_RUNBOOK.md`**: owner-only database operations and recovery procedures.
- **`help.md`** / **`about.md`**: content for the `/help` page and About dialog.
- **`docs/github-workflow.md`**: squash merges, auto-merge, branch cleanup, and Dependabot workflow.
- **`docs/ui-density.md`**: density, touch-target, and row-layout rules.
- **`docs/supply-chain-security.md`**: dependency, CI, and developer-machine security practices.
