# grampacker v2 — Design Document

This document describes how to build grampacker on a TypeScript/React/Supabase stack, given the requirements specified in REQUIREMENTS.md. It is the design companion to that document — REQUIREMENTS describes *what* the app does; this describes *how* v2 implements it.

This doc is the seed for the v2 implementation chat. It is not final — library versions in particular must be verified via web search at project kickoff, not taken from this doc.

---

## Stack

**Frontend**
- React 19.2.5
- TypeScript 6.0.3 — see notes below
- Vite 8.0.9 — see notes below
- Tailwind CSS 4.2.0 — **config idiom changed from v3**; see notes below
- React Router 7.14.2 — use **library mode** (not framework mode); see notes below
- TanStack Query (`@tanstack/react-query`) 5.99.2
- `@supabase/supabase-js` 2.103.3
- `@dnd-kit/core` 6.3.1 — use the **legacy stable package**; see notes below
- `vaul` 1.1.2 — for the mobile bottom sheet
- `papaparse` 5.5.3 — CSV parsing; types in `@types/papaparse` (separate install)
- `vite-plugin-pwa` 1.2.0 — PWA support
- `fflate` 0.8.2 — client-side zip generation for data export (resolved open question; preferred over JSZip)

**Backend**
- Supabase (managed Postgres, Auth, Storage if needed)
- Supabase Edge Functions only if a server-side path is unavoidable (TBD per feature)

**Hosting**
- Frontend: Cloudflare Pages (free tier), serving `grampacker.app`
- Backend: Supabase managed (free tier)
- Domain: `grampacker.app`, registered via Cloudflare

**Dev tooling**
- ESLint v9 + Prettier — **flat config format** (`eslint.config.js`, not `.eslintrc`); see notes below
- Vitest 4.1.4 for unit tests
- Playwright for end-to-end tests, if/when added

**Version verification rule**: every library version above was confirmed via web search on 2026-04-25. APIs and config formats change between major versions — see the version notes section below before starting Phase 1.

---

## Version Notes (verified 2026-04-25)

These are the idiom changes discovered during version verification that affect how we set things up. Read before starting Phase 1.

### TypeScript 6.0
- `strict: true` is now the **default** — no need to set it in `tsconfig.json` for a new project
- Use `"moduleResolution": "bundler"` (not `"node"`) for Vite projects
- `"target": "ES2020"` or higher — `"es5"` is removed
- `"types": []` is the new default; global ambient types must be listed explicitly. **Vite projects must include `"types": ["vite/client"]`** — without it, `import.meta.env` and CSS side-effect imports both produce type errors
- `esModuleInterop` is now always on and cannot be set to false
- TypeScript 7.0 (Go-based compiler, 10x faster) is in beta — TS 6.0 is the last JS-based release; upgrade path will exist

### Vite 8
- Rolldown (Rust-based) replaces Rollup as the default bundler — 10–30x faster production builds
- Plugin API is backward-compatible; our config should work as expected
- No action required beyond installing 8.x

### Tailwind CSS 4.2 — breaking config change from v3
Old v3 idiom (do not use):
```js
// tailwind.config.js — gone
// postcss.config.js — gone
// @tailwind base; @tailwind components; @tailwind utilities; — gone
```
New v4 idiom:
```ts
// vite.config.ts
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({ plugins: [tailwindcss()] })
```
```css
/* src/index.css */
@import "tailwindcss";
/* Custom tokens via @theme {} blocks, not JS config */
```
Install: `npm i -D tailwindcss @tailwindcss/vite`

### React Router 7
v7 merged with Remix and has two modes. **We use library mode** (no `react-router.config.ts`):
- Works exactly like v6 — `<BrowserRouter>`, `<Routes>`, `<Route>`, `useNavigate`, etc.
- No SSR, no build-time rendering, just client-side routing — perfect for Cloudflare Pages static hosting
- Framework mode (the other mode) is Remix-style, has `ssr: false` SPA option, but has more ceremony and some rough edges in pure-SPA scenarios; not needed here

### dnd-kit
The library is in architectural transition:
- `@dnd-kit/core` v6.3.1: stable, well-documented, last published ~1 year ago — **use this**
- `@dnd-kit/react` v0.4.0: new architecture, actively developed, but pre-1.0 and not yet production-ready per the maintainer
- Re-evaluate `@dnd-kit/react` if it hits 1.0 before we start Phase 3 (drag-and-drop is Phase 2–3 work)

### ESLint v9 flat config
`.eslintrc.*` files are gone. Config is now `eslint.config.js` exporting an array:
```js
// eslint.config.js
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
export default tseslint.config(
  ...tseslint.configs.recommended,
  prettierConfig,          // must be last — disables formatting rules
)
```
Install: `npm i -D eslint typescript-eslint prettier eslint-config-prettier`

### Zip library (open question resolved)
Use **fflate** v0.8.2 for client-side zip generation. Faster than JSZip, modern streaming API, works well in browsers and PWAs. For our data export volumes (small files) the performance difference is academic, but fflate is the better-maintained library.

---

## Database Schema

All tables live in the `public` schema. Postgres-flavored SQL below; Supabase will run it via SQL Editor or migrations.

### `profiles`

Supabase Auth manages the `auth.users` table for us. We add a `profiles` table keyed by the auth user ID for app-specific user data.

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,64}$')
);

create index profiles_username_lower_idx on public.profiles (lower(username));
```

A trigger creates a profile row automatically when a new `auth.users` row is inserted, populating `username` from the user's signup metadata.

```sql
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Username uniqueness is enforced case-insensitively at the app layer (lowercase before insert) plus a lower-case index.

### `categories`

```sql
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) <= 128),
  sort_order integer not null default 0,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index categories_user_sort_idx on public.categories (user_id, sort_order, name);
```

The seven default categories are created via a Postgres function called from the new-user trigger, or by the client immediately after signup. Either works; client-side is simpler to reason about.

### `gear_items`

```sql
create table public.gear_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (length(name) between 1 and 256),
  description text check (length(description) <= 2000),
  weight_grams integer not null default 0 check (weight_grams between 0 and 100000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index gear_items_user_idx on public.gear_items (user_id, sort_order, name);
create index gear_items_user_name_lower_idx on public.gear_items (user_id, lower(name));
```

The 500-item-per-user cap is enforced via a `before insert` trigger that counts existing items.

### `lists`

```sql
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 256),
  description text check (length(description) <= 2000),
  share_token text not null unique check (length(share_token) = 8),
  is_shared boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index lists_user_idx on public.lists (user_id, sort_order, updated_at desc);
create index lists_share_token_idx on public.lists (share_token) where is_shared = true;
```

The 100-list-per-user cap is enforced via a `before insert` trigger.

`share_token` is generated client-side at insert time using a URL-safe alphanumeric character set; on the rare collision the client retries (up to 5 attempts, matching v1).

### `list_items`

```sql
create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists(id) on delete cascade,
  gear_item_id uuid not null references public.gear_items(id) on delete cascade,
  quantity integer not null default 1 check (quantity >= 1),
  weight_grams integer not null check (weight_grams between 0 and 100000),
  is_worn boolean not null default false,
  is_consumable boolean not null default false,
  is_packed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worn_xor_consumable check (not (is_worn and is_consumable))
);

create index list_items_list_idx on public.list_items (list_id, sort_order, id);
```

The 300-items-per-list cap is enforced via a `before insert` trigger.

### `updated_at` triggers

Every table with an `updated_at` column gets a generic trigger to maintain it:

```sql
create function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
-- same pattern for gear_items, lists, list_items
```

---

## Row-Level Security (RLS)

RLS is the security model of v2. With RLS enabled and policies in place, the database itself prevents cross-user data access — even if the frontend has a bug, the database refuses to serve user A's data to user B.

Enable RLS on every table:

```sql
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.gear_items enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
```

### `profiles`

Users can read and update their own profile. Public profile data (just username, for "shared by X" attribution if we add it) is not exposed by default.

```sql
create policy profiles_self_select on public.profiles
  for select using (auth.uid() = id);

create policy profiles_self_update on public.profiles
  for update using (auth.uid() = id);
```

Insert is handled by the trigger; no client insert policy needed.

### `categories`, `gear_items`

Standard "user owns their rows" pattern:

```sql
create policy categories_owner_all on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy gear_items_owner_all on public.gear_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `lists`

Owner can do anything to their own lists. Public can read shared lists by token:

```sql
create policy lists_owner_all on public.lists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy lists_public_select_shared on public.lists
  for select using (is_shared = true);
```

The public select policy returns the row when `is_shared = true`. The client filters the response to omit fields the public shouldn't see (we'll handle this with a Postgres view, see below).

### `list_items`

Owner can do anything to items in their lists. Public can read items belonging to shared lists:

```sql
create policy list_items_owner_all on public.list_items
  for all using (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.lists l where l.id = list_id and l.user_id = auth.uid())
  );

create policy list_items_public_select_shared on public.list_items
  for select using (
    exists (select 1 from public.lists l where l.id = list_id and l.is_shared = true)
  );
```

### Public share view

To handle "internal IDs and `is_packed` should be hidden from the public share response," we create a view that exposes only the public-safe columns:

```sql
create view public.shared_list_items as
select
  li.id,            -- exposed; UI needs a stable key. If we want to hide, generate a derived hash
  li.list_id,
  li.gear_item_id,
  li.quantity,
  li.weight_grams,
  li.is_worn,
  li.is_consumable,
  li.sort_order,
  gi.name as gear_name,
  gi.description as gear_description,
  gi.weight_grams as inventory_weight_grams,
  c.id as category_id,
  c.name as category_name,
  c.sort_order as category_sort_order
from public.list_items li
join public.lists l on l.id = li.list_id
join public.gear_items gi on gi.id = li.gear_item_id
left join public.categories c on c.id = gi.category_id
where l.is_shared = true;
```

REQUIREMENTS specifies the public weight should use the live inventory weight, not the snapshot — `gi.weight_grams` rather than `li.weight_grams`. The view exposes both; the public client uses `inventory_weight_grams`.

If hiding `list_items.id` from the public response matters more than ergonomics, the view can replace it with a hash. v1 did hide IDs; for v2 I'd argue exposing them is fine (the IDs are UUIDs, not enumerable, and the share is opt-in). User decision at implementation time.

---

## Auth Flow

Supabase Auth handles the heavy lifting. The client integration is small.

### Signup

```typescript
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: { username }  // stored in raw_user_meta_data; trigger reads this
  }
});
```

The new-user trigger creates the profile row. Default categories can be created either by the trigger (extending it to seed categories) or by the client immediately after signup. Client-side is simpler to debug; doing it in the trigger is more atomic. Recommend client-side for v1.

### Login

```typescript
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password
});
```

Supabase issues a JWT, stores the session in `localStorage` (configurable), refreshes automatically. The frontend uses `supabase.auth.getSession()` to check auth state and `supabase.auth.onAuthStateChange()` to react to login/logout.

### Password reset

```typescript
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: `${window.location.origin}/auth/reset`
});
```

Supabase emails a magic link. The redirect target is a route in our app that calls `supabase.auth.updateUser({ password })`.

### Sign out everywhere

On password change, after the password update succeeds:

```typescript
await supabase.auth.signOut({ scope: 'others' });
```

Equivalent to v1's session_version increment.

### Email verification

Supabase default behavior. Configurable in the Supabase dashboard. Recommend leaving on.

---

## Frontend Architecture

### File structure

```
src/
  lib/
    supabase.ts          # Supabase client singleton
    queries.ts           # TanStack Query keys + reusable query functions
    weight.ts            # Pure conversion / formatting functions
    csv.ts               # CSV parse / serialize / sanitize
    share-token.ts       # 8-char token generator
  auth/
    AuthProvider.tsx     # Context wrapping Supabase auth state
    LoginPage.tsx
    SignupPage.tsx
    ResetPasswordPage.tsx
    ConfirmResetPage.tsx
  layout/
    AppShell.tsx         # Top-level layout, nav, route outlet
    NavBar.tsx
  gear/
    GearLibraryPage.tsx
    GearItemRow.tsx
    GearItemEditDialog.tsx
    BulkActionsToolbar.tsx
    CategoryHeader.tsx
    NewGearItemDialog.tsx
  lists/
    ListIndexPage.tsx
    ListCard.tsx
    ListDetailPage.tsx
    ListHeader.tsx
    ListActionBar.tsx
    DescriptionEditor.tsx
    WeightTable.tsx
    ListItemRow.tsx
    LibraryPanel.tsx     # Desktop sidebar
    LibrarySheet.tsx     # Mobile bottom sheet
    NewListItemDialog.tsx
    ShareControls.tsx
    PackingPage.tsx
  share/
    PublicSharePage.tsx  # /r/:token
  account/
    SettingsPage.tsx
    ChangePasswordSection.tsx
    DeleteAccountSection.tsx
    DataExportSection.tsx
  routes.tsx
  App.tsx
  main.tsx
```

The grouping is by feature, not by technical layer. Each feature folder owns its components, dialogs, and feature-local hooks.

### State management

- **Server state**: TanStack Query exclusively. Each entity (gear items, lists, list items, categories) gets its own query keys and cached fetchers. Mutations invalidate keys precisely.
- **Client UI state**: React's `useState` / `useReducer`. No global store.
- **Auth state**: a small context (`AuthProvider`) that subscribes to Supabase's `onAuthStateChange`.
- **Persistent UI prefs**: `localStorage`, accessed via small typed helpers (e.g., `getWeightUnit()`, `setWeightUnit()`).

### Realtime

Supabase supports realtime subscriptions to table changes. **Don't enable by default.** v1 doesn't have this and we don't need it. Add later only if there's a specific reason (e.g., collaborative lists). YAGNI applies.

### PWA setup

- `vite-plugin-pwa` configured with a manifest and service worker
- Offline strategy: app shell + library data cached; mutations queued when offline (TanStack Query has primitives for this)
- Install prompt: standard browser behavior, no custom UI for v1

PWA polish (offline write queue, conflict resolution, etc.) is its own phase. Get the online version working first.

---

## Weight, CSV, and Other Pure Logic

These belong in `src/lib/` as pure functions, free of React and Supabase. They're easy to unit-test and don't change between web and any future native shells.

- `weight.ts`: gram→oz conversion (factor 0.035274), gram→lb-oz formatting, parsing user input
- `csv.ts`: parse (papaparse), serialize, sanitize cells starting with `=`, `+`, `-`, `@`, sanitize filenames
- `share-token.ts`: `crypto.getRandomValues` over a URL-safe charset, 8 chars

Vitest tests for each. These are exactly the kind of functions where unit tests pay for themselves.

---

## CSV Import

REQUIREMENTS specifies two import paths: list import (with deduplication) and gear-only import (without). In v2 these are entirely client-side:

1. User picks a file.
2. Client parses with papaparse, max 2 MB enforced before parse.
3. For list import: load the user's existing categories and gear items, walk the rows, build a plan (categories to create, items to create, items to reuse, list_items to insert), then execute as a Supabase transaction-like sequence. Real Postgres transactions across the wire are awkward; instead, group inserts and accept that partial failure leaves a partial list, with a clear error message.
4. For gear-only import: simpler — just insert N gear_items.

Per-user caps are enforced before write by counting existing rows. The v1 rule "must be under 100 lists, under 300 items per list, gear count + row count ≤ 500" carries over; the client checks all three.

The "rate-limited to 10 imports per hour" rule is dropped per our discussion — Supabase's defaults are sufficient and per-feature rate limiting on a hobby app is over-engineering.

---

## Public Share View

Route: `/r/:token` (matches v1).

Implementation:
1. Public route, no auth required. Supabase client uses the anon key for this view.
2. Query: `select * from lists where share_token = :token and is_shared = true`. Returns 0 or 1 row. If 0, render 404.
3. Query: `select * from shared_list_items where list_id = :id`. Returns the items via the view.
4. Render the read-only view with weight table, items grouped by category, weight unit toggle. Same `weightUnit` localStorage key as the authenticated app.

The 60-requests-per-minute rate limit from v1 is dropped — Supabase's defaults handle abuse cases adequately for a hobby app.

---

## Deployment

### Repo and project setup
- New `grampacker` repo on GitHub
- Cloudflare Pages project connected to the repo, auto-deploys main branch
- Custom domain `grampacker.app` attached to the Pages project (DNS managed in same Cloudflare account)
- Supabase project created in a region close to Cloudflare's edge (low latency)
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` set in Cloudflare Pages build settings, injected at build time

### Database migrations
Supabase has a CLI that supports migration files in version control. Recommend using it from day one — no clicking around in the dashboard for schema changes. The schema in this doc becomes the first migration.

### Branches and previews
Cloudflare Pages gives per-branch preview deploys automatically (e.g., `branch-name.grampacker-app.pages.dev`). Standard practice — push a feature branch, get a preview URL. Supabase can do branch databases too (paid feature — skip on free tier; use a single dev DB).

---

## Build Order

The goal of this sequence: every phase ends with something runnable and useful. No 6-week foundation phase.

### Phase 1: Foundation (1 evening)
- New repo, Vite + React + TS scaffold
- Tailwind installed and configured (verify version idioms)
- Supabase project created, environment vars wired up
- First migration: `profiles` table, RLS, new-user trigger
- Login + signup pages working end-to-end
- Empty authenticated landing page

**Deliverable**: a deployed site where you can sign up and log in.

### Phase 2: Gear library (2-3 evenings)
- Migrations: `categories`, `gear_items`, RLS, default categories
- TanStack Query setup
- Gear library page with CRUD
- Inline edit, full-form edit dialog
- Category creation, rename, delete, drag reorder
- Search/filter

**Deliverable**: a working gear library you could actually use to track inventory.

### Phase 3: Lists (3-4 evenings)
- Migrations: `lists`, `list_items`, RLS
- List index page, create, rename, delete, duplicate
- List detail page: layout, weight table, items grouped by category
- Library panel (desktop), library sheet (mobile)
- Add items to list (both flows)
- Inline weight/quantity edit, worn/consumable toggle, drag reorder

**Deliverable**: a usable Lighterpack alternative for your own use.

### Phase 4: Sharing and packing (1-2 evenings)
- `shared_list_items` view, public RLS policies
- Share token generation, toggle, regenerate
- `/r/:token` public page
- Packing mode page

**Deliverable**: shareable to anyone, packing-mode usable on a phone.

### Phase 5: CSV (1-2 evenings)
- Pure CSV functions in `lib/csv.ts` with tests
- Library export and import
- List export and import

**Deliverable**: data portability done.

### Phase 6: Settings and polish (1-2 evenings)
- Change password, delete account, download data zip
- Loading states, error boundaries, empty states
- PWA manifest and install prompt
- Mobile testing pass

**Deliverable**: production-ready v2.

### Phase 7: ~~Migrate Joe's data~~ (skipped)
No data migration. v2 launches empty; Joe will populate it fresh.

Phases are sized for "an evening's work" but there's no schedule. Joe works on it when he has time.

---

## Open Questions for Implementation Time

Things deliberately not decided here, to be resolved in the new chat:

1. **Default categories: trigger vs. client-side seeding.** Trigger is more atomic; client is easier to debug. Lean client.
2. **PWA install prompt UX.** Browser default vs. custom. Recommend browser default for v1.
3. **Data export `account.json` format and zip generation.** v1 generates a zip server-side; in v2 we do it client-side. Use **fflate** v0.8.2 (resolved — see Version Notes). The data is the user's own — no privacy issue with client-side generation.
4. **Whether to add tests as we go or in a dedicated phase.** Recommend: pure functions get tests during their phase (csv.ts, weight.ts); component tests only for genuinely tricky components.

## Decisions Locked In

- **Sharing is per-list, opt-in, off by default.** Each list has an 8-character `share_token` generated at creation. Lists are private until the user explicitly toggles sharing on. The token is visible in the share URL `/r/:token` only when `is_shared = true`. Matches v1 behavior and Lighterpack's pattern. Token character set: letters only (a-z, A-Z), 8 characters, matching Lighterpack's convention.
- **`list_items.id` exposure in public share view.** Expose UUIDs. They're not enumerable, the share is opt-in, and exposing them simplifies the React keys.
- **Email verification.** Use Supabase default (on). Joe doesn't care, default is sane.
- **No data migration from v1.** v2 launches empty. Joe populates fresh.

---

## Working Agreement for the New Chat

The new chat starts with three documents:
1. REQUIREMENTS.md (the what)
2. This document (the how)
3. A short kickoff prompt (context, model strategy, version verification rule)

The new chat's first job is **not** to write code. It's to:
1. ~~Web-search and confirm current versions for every library marked TO VERIFY~~ ✓ Done 2026-04-25
2. ~~Update this document with confirmed versions~~ ✓ Done 2026-04-25
3. Then begin Phase 1

Model strategy in the new chat:
- Opus for design decisions, schema review, RLS auditing, code review checkpoints, debugging
- Sonnet for implementation, boilerplate, well-defined refactors

Joe will signal when to switch models. Default to Sonnet for routine writing; switch to Opus when stuck or when the decision matters.

Version verification rule: no library version is pinned without a search result backing it. If a version appears without a search, it's suspect. Web search before pinning, and verify current API idioms (config formats, breaking changes), not just version numbers.
