# grampacker — security audit (2026-05-04)

Whole-project audit covering Supabase migrations (RLS, SECURITY DEFINER, search_path, GRANTs), frontend auth flow, env-var exposure, client-trusted data, XSS surfaces, security headers, and dependency posture.

Verdict in one line: the database security model is solid and well-documented. The two most prominent gaps are at the edge — there are **no HTTP security headers** (no CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy) on the Cloudflare Pages deployment, and Supabase auth tokens live in `localStorage` (the default) which makes any future XSS a session-takeover. Everything else is small.

Severity scale: Critical / High / Medium / Low / Info.

---

## Findings

### F1 — High — No security headers / CSP on Cloudflare Pages

- **Where:** No `public/_headers`, `_redirects`, `wrangler.toml`, or equivalent in the repo. `index.html` ships no `<meta http-equiv="Content-Security-Policy">` either. The deployed site therefore serves with Cloudflare's defaults plus whatever Pages auto-adds — i.e. effectively no app-level security headers.
- **Threat scenario:** An XSS bug anywhere downstream of React (a third-party dep that injects HTML, a future `dangerouslySetInnerHTML`, a click-jacking iframe embed, a third-party script smuggled in by a compromised CDN) is unmitigated. With Supabase JWTs in `localStorage` (see F2), any successful XSS is a full account takeover plus exfiltration of the entire gear library and lists. With no `X-Frame-Options` / `frame-ancestors`, the share view (`/r/:slug`) and the authenticated app are both clickjackable.
- **Exploitability:** Today, low — the React/Markdown stack auto-escapes, `react-markdown` is used without `rehype-raw`, and no `dangerouslySetInnerHTML` exists in the source tree. This is almost entirely defense-in-depth. But the cost of adding it is one file.
- **Recommended fix:** Create `public/_headers` (Cloudflare Pages reads this verbatim — no wrangler config needed for static Pages):

  ```
  /*
    Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://ichohopmuqdwbowsxpob.supabase.co wss://ichohopmuqdwbowsxpob.supabase.co; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; manifest-src 'self'; worker-src 'self'
    X-Content-Type-Options: nosniff
    X-Frame-Options: DENY
    Referrer-Policy: strict-origin-when-cross-origin
    Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
    Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
    Cross-Origin-Opener-Policy: same-origin
  ```

  App-specific notes:
  - `connect-src` must include the Supabase project URL (REST + realtime). Hard-coding production is fine — only one project, and `_headers` is build-time static.
  - Tailwind injects styles via inline `<style>`; `'unsafe-inline'` on `style-src` is required.
  - `frame-ancestors 'none'` plus `X-Frame-Options: DENY` are both included for redundancy. There is no use case for being framed.
  - `worker-src 'self'` covers the PWA service worker (`sw.js`).
  - Verify after deploy with `curl -I https://<your-pages-url>/`.

### F2 — Medium — Auth tokens in localStorage (Supabase default)

- **Where:** `/Users/joe/code/grampacker/src/lib/supabase.ts:17` — `createClient(supabaseUrl, supabaseAnonKey)` with no second-arg options. Defaults: `persistSession: true`, `storage: window.localStorage`, `autoRefreshToken: true`. The JWT and refresh token sit in `localStorage.sb-<project>-auth-token`.
- **Threat scenario:** Any XSS exfiltrates both tokens. The current-password gate on in-app password change (`SettingsPage.tsx:117`) limits password rotation, but `delete_account()` only checks `auth.uid() is null` (see F3). Within a stolen session, the attacker has full read/write of the user's data and can delete the account.
- **Exploitability:** Conditional on XSS. Today there is no obvious vector — combined with F1's missing CSP this is the broadest single failure mode.
- **Recommended fix:** Ship F1 first; CSP is the practical mitigation. Cookie-based session storage is possible (custom `storage` adapter) but only meaningful if you put a server in front of the app, which grampacker doesn't have. Don't pursue half-measures — document the residual risk in `SECURITY.md` once F1 is shipped.

### F3 — Medium — Account deletion has no re-authentication

- **Where:** `/Users/joe/code/grampacker/supabase/migrations/20260426000000_delete_account_rpc.sql:11-16` + `/Users/joe/code/grampacker/src/settings/SettingsPage.tsx:267`. The `delete_account()` RPC checks only `if auth.uid() is null` and then `delete from auth.users where id = auth.uid()`. The frontend gates with `TypedConfirmDialog` (type "delete"), which is friction for an honest user, not protection against a compromised session.
- **Threat scenario:** A stolen access token (XSS, lost laptop, shared browser) can permanently delete the account and cascade-wipe all data. There is no soft delete or recovery.
- **Exploitability:** Requires session compromise. The asymmetry with the in-app password change (which DOES require current password) is what makes this a finding: the right pattern already exists 150 lines up in the same file.
- **Recommended fix:** In `DeleteAccount` (`SettingsPage.tsx:258`), add a current-password verification step before calling the RPC, mirroring `ChangePasswordForm`:

  ```ts
  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: session.user.email!,
    password: currentPassword,
  })
  if (verifyError) { setErr('Current password is incorrect.'); return }
  const { error } = await supabase.rpc('delete_account')
  ```

  Surface a generic "Current password is incorrect" rather than verbatim Supabase errors, same as the password-change flow.

### F4 — Low — `lists_public_select_shared` policy lets anon enumerate every shared slug

- **Where:** `/Users/joe/code/grampacker/supabase/migrations/20260425000002_lists_and_list_items.sql:21-22`. Policy is `using (is_shared = true)` — no slug constraint. An anon caller can issue `GET /rest/v1/lists?is_shared=eq.true&select=slug` and pull every currently-shared slug.
- **Status:** Documented and accepted in `SECURITY.md` ("Public read paths (sharing)"). The accepted-risk reasoning is reasonable: shared = opt-in public-readable.
- **Disconnect:** The user-facing copy in `/Users/joe/code/grampacker/src/lists/PrivacyPanel.tsx:40` says *"Anyone with this link can view the list"* — implying the link is required. It isn't.
- **Recommended fix (cheap):** Tighten `PrivacyPanel.tsx:40` copy to make the enumeration property explicit, e.g. *"Public — viewable by anyone, listed in the public directory."*
- **Recommended fix (full):** Move public reads behind a `SECURITY DEFINER fetch_shared_list(p_slug text)` RPC, revoke direct SELECT on `lists` from anon, and have `fetchSharedList` call the RPC. Also requires reshaping `list_items_public_select_shared`, `gear_items_public_select_via_shared_list`, `categories_public_select_via_shared_list` similarly. Significant work for an already-accepted risk; only do it if the threat model changes.

### F5 — Low — Future-proofing: no `react/jsx-no-target-blank` ESLint rule

- **Where:** `/Users/joe/code/grampacker/eslint.config.js`. The only `target="_blank"` in the codebase today is in `MarkdownPage.tsx:37` and correctly sets `rel="noopener noreferrer"`. Modern browsers default `target="_blank"` to `noopener` since 2020-ish, so this is largely a guardrail concern.
- **Recommended fix:** Add the rule (it's part of `eslint-plugin-react`, which isn't in the project today — you have `eslint-plugin-jsx-a11y` and `eslint-plugin-react-hooks`). Or add a brief note in `CLAUDE.md` "What NOT to do" if you don't want another plugin.

### F6 — Info — `MarkdownPage` is configured safely; pin the configuration with a comment

- **Where:** `/Users/joe/code/grampacker/src/components/MarkdownPage.tsx:61` — `<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>`. No `rehypePlugins`. The two callers (`AboutPage.tsx`, `HelpPage.tsx`) feed content via `?raw` build-time imports, so `content` is never user-controlled today.
- **Recommended fix:** Add a header comment to `MarkdownPage.tsx`: *"Do not enable rehype-raw or accept user-controlled content here. This component must continue to receive only build-time bundled markdown."* One-line guardrail against a future drift turning this into a user-content XSS surface.

### F7 — Info — Verify Supabase dashboard config

- **Where:** Configuration, not code. `ForgotPasswordPage.tsx:34` uses `redirectTo: \`${window.location.origin}/reset-password\``; this works only if the origin is in the project's redirect URL allowlist.
- **Action items:**
  - Access token TTL ≤ 1 hour.
  - Refresh token rotation enabled.
  - "Reuse interval" short.
  - Redirect URL allowlist contains only known origins.
  - "Confirm email" enabled (the login flow at `LoginPage.tsx:30` reads as if it is — confirms by handling the "email not confirmed" error).
- **Status:** Requires dashboard access to verify. No code change.

### F8 — Info — Service-worker cache is URL-keyed, not auth-keyed

- **Where:** `/Users/joe/code/grampacker/vite.config.ts:32-54`. Already documented in the comment block: cross-user cache pollution on a shared browser is possible because the cache key is the URL only. Auth endpoints are correctly NetworkOnly; only `GET /rest/v1/` (excluding RPCs) is cached, with `StaleWhileRevalidate`.
- **Recommended fix when assumption changes:** Either implement `cacheKeyWillBeUsed` to mix the auth `sub` claim into the key, or call `caches.delete('supabase-rest')` on signOut. Today's solo-user assumption is reasonable.

### F9 — Info — `bulk_update_sort_order` no longer uses dynamic SQL

- **Where:** `/Users/joe/code/grampacker/supabase/migrations/20260501000000_bulk_reorder_rpc_ownership_check.sql`. The original (`20260430000000`) used `format('update %I ...')`; the rewrite uses IF/ELSIF branches with hardcoded table identifiers. No SQL injection surface. Also: ownership is enforced inline per branch (`auth.uid() = user_id` for direct-owned tables; join filter on `lists` for `list_items`).
- **Status:** Correct pattern. Listed for the audit record.

### F10 — Info — Service-role / secret keys are not in the repo or built bundle

- **Where:** Verified `.env`, `.env.example`, and `dist/assets/index-*.js`. The bundle contains the project ref `ichohopmuqdwbowsxpob` and the literal `sb_publishable` (the publishable/anon key prefix); no `sb_secret`, no `service_role`. `.env` is `.gitignore`d.
- **Status:** Correct. Anon key in client is by design.

### F11 — Info — `delete_account` original migration's search_path was missing pg_temp; already remediated

- **Where:** `20260426000000` set `search_path = public`; `20260505000000_fix_delete_account_search_path.sql` corrected it to `public, pg_temp`. Listed because `SECURITY.md` calls out this fix; just confirming it landed.

### F12 — Info — Vite build does not strip `console` calls; the only production log is intentional

- **Where:** `/Users/joe/code/grampacker/src/App.tsx:27-29` gates `console.error` on `import.meta.env.DEV`. No tokens or PII logged. No action.

### F13 — Info — CSV import has a 2 MB size cap and formula-injection neutralization on export

- **Where:** `/Users/joe/code/grampacker/src/lib/use-csv-file-input.ts:3` (size cap) and `/Users/joe/code/grampacker/src/lib/csv/core.ts` (formula-injection neutralization on export — leading `=`/`+`/`-`/`@`/`\t`/`\r` get a `'` prefix). Import side intentionally does not strip the prefix to preserve Lighterpack round-trips.
- **Status:** Correct.

---

## Items already done well (no action)

- **RLS coverage.** Every table in `public` has RLS enabled; both owner-keyed (`auth.uid() = user_id`) and joined-via-parent patterns are used correctly. The `rls_auto_enable` event trigger (`20260429000000`) is a defense-in-depth net.
- **`WITH CHECK` clauses on all UPDATE/INSERT-allowing policies**, including the `profiles_self_update` retrofit (`20260505000001`).
- **Composite FKs anchor cross-owner enforcement** without RLS-recursion problems (`20260506000002`, with the lessons-learned trail through `20260506000000` / `00001`).
- **All four SECURITY DEFINER functions (`handle_new_user`, `delete_account`, `bulk_update_sort_order`, `rls_auto_enable`)** have `search_path` pinned, EXECUTE revoked from `public`/`anon`, EXECUTE granted to `authenticated` only for user-callable ones (revoked for trigger-only), and inline ownership checks compensating for RLS bypass.
- **Public read paths use explicit column allowlists** (`fetchSharedList`, `fetchSharedListItems`, `fetchSharedListCategories`) — wire responses don't leak `user_id`/`is_shared`/etc. independent of RLS.
- **Query-level owner scoping** on every private fetch helper (defense in depth against `*_public_select_*` policy bleed-through to authenticated callers).
- **CSV formula-injection neutralization** on every export cell (`src/lib/csv/core.ts`).
- **In-app password change requires current-password re-auth** (`SettingsPage.tsx:117`).
- **Recovery-only `/reset-password`** that requires the recovery code, redirects authenticated users without a code to `/settings` (`ResetPasswordPage.tsx:60-74`).
- **Anti-enumeration on forgot-password** — same success message regardless of whether the email is registered (`ForgotPasswordPage.tsx:46`).
- **Slug generator uses `crypto.getRandomValues` with rejection sampling** to avoid modulo bias (`slug.ts:24`).
- **No `dangerouslySetInnerHTML`, no `innerHTML` writes, no `eval`, no `document.write`, no raw `fetch` to user-controlled URLs** anywhere in the source tree.
- **`react-markdown` invoked without `rehype-raw`** — markdown stays as text, no embedded-HTML XSS surface.
- **External markdown links carry `rel="noopener noreferrer"`** (`MarkdownPage.tsx:37`).
- **Service worker excludes `/auth/v1/`** from caching (NetworkOnly) and only caches `GET /rest/v1/` (no mutations cached, no RPCs cached).
- **Per-user resource caps at the database level** (`check_gear_item_limit` 500, `check_list_cap` 100, `check_list_item_cap` 300).

---

## Prioritized remediation list

1. **F1 — add `public/_headers` with CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS, Permissions-Policy, COOP.** Single file. Verify with `curl -I` after deploy. Highest-leverage single change in this audit.
2. **F3 — add current-password re-authentication to the Delete account flow** in `SettingsPage.tsx`. Mirror the existing `ChangePasswordForm` pattern. ~20 lines of UI + state.
3. **F4 — tighten the share-link copy** in `PrivacyPanel.tsx:40` to make the enumeration property explicit (or, if you want to close it, hide the public read path behind a `SECURITY DEFINER fetch_shared_list(p_slug)` — bigger lift, only do if threat model changes).
4. **F5 — add `react/jsx-no-target-blank` ESLint rule** so future external links are enforced by tooling. (Or document in `CLAUDE.md`.)
5. **F2 — document the localStorage-token residual risk in `SECURITY.md`** alongside ADR 3's "Accepted linter warning" pattern, cross-referencing F1 as the practical mitigation. Configuration only.
6. **F7 — verify Supabase dashboard config** (JWT TTL, refresh-token rotation, redirect URL allowlist, "Confirm email" enabled). Configuration only — no code change.
7. **F6 — add the guard comment** to `MarkdownPage.tsx`. One-line.

Everything below F4 is informational / defense-in-depth and can be deferred indefinitely.
