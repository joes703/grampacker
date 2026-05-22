# grampacker

A gear-weight tracking app for hikers and backpackers. Maintain a personal gear inventory, build trip-specific packing lists from it, and the app totals base / worn / consumable / pack weight for you.

Live at <https://grampacker.app>. Personal project, free to use.

## Stack

TypeScript + React 19 + Vite, Tailwind CSS 4, TanStack Query, Supabase (Postgres + Auth + RLS), Cloudflare Pages. CSV import/export is LighterPack-compatible. See `help.md` (also rendered at `/help`) for the user-facing tour and the rationale-style FAQs.

## Run locally

```
npm ci
npm run dev
```

Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env`. Database migrations live in `supabase/migrations/`; apply via the Supabase CLI or the dashboard SQL editor.

`npm run build` runs `tsc -b && vite build` and is what Cloudflare Pages runs on deploy. Always use it (not `tsc --noEmit`) to verify before committing.

`npm run security:check` runs npm audit, registry signature/provenance verification, and a narrow supply-chain IOC scan. Dependency lifecycle scripts are blocked by default via `.npmrc`; if a package ever needs an install script, review and document the exception.

## Docs

- **`CLAUDE.md`**: agent instructions for working on this codebase. Verification rules, TypeScript gotchas, database patterns, cache invalidation, UX patterns. Read first.
- **`DECISIONS.md`**: short ADRs explaining *why* the app is shaped this way (cross-category DnD removed, RPC-based bulk writes, kebab-only row actions, etc.). Read when you wonder "why is this like this?"
- **`SPEC.md`**: current behavior reference for resource limits, weight rollups, sharing mechanics, CSV format, and RLS patterns. Read when you need a precise answer to "what does this do?"
- **`help.md`** / **`about.md`**: user-facing pages rendered at `/help` and `/about`.
- **`docs/ui-density.md`**: row height, touch target, and flat table/row visual grammar rules for list, gear, picker, pack, and share surfaces.
- **`docs/supply-chain-security.md`**: dependency, CI, and developer-machine security practices.
