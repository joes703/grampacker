# Phase 19 — REVIEW-security.md closure (2026-05-06)

> **Status (locked):** spec for Codex review. Do not execute until the user gives the go-ahead.

## Goal

Close `REVIEW-security.md` as a campaign artifact. The audit dates to 2026-05-04 with 13 findings (F1–F13). Phases 1 and 10 already shipped the substantive work; Phase 19's job is to (a) ship the one remaining commit the audit explicitly recommended and (b) confirm closure in `REVIEW-FIX.md` so the campaign can move on to `REVIEW-performance.md`.

## Why this phase is small

`REVIEW-FIX.md:383` (Phase 10 summary) already states:

> After Phase 10, REVIEW-security.md is substantially closed: F1, F3, F6, F11 done in earlier phases; F4 closed via cheap path here; F5, F7, F8 closed as docs/guardrails; F2 is accepted-risk for the BaaS architecture; F9, F10, F12, F13 were already info-only confirmations.

I re-verified each closure against the current codebase before writing this spec (see "Audit-stale closures" below for the per-finding evidence). Two gaps surfaced during verification:

- **F2 documentation** — the audit's recommendation to *document* the localStorage residual risk in `SECURITY.md` was deferred when F1 was still pending. F1 has shipped; F2's documentation can land now. (C1.)
- **SECURITY DEFINER inventory drift** — `SECURITY.md`'s "Inventory" table and "We use it sparingly — four functions total" line predate Phase 8's three consolidated-mutation RPCs (`add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`, all in migration `20260510000000`). Closing `REVIEW-security.md` while the inventory is stale would publish the wrong picture; refreshing it is in scope for the same closure pass. Surfaced by Codex on this spec, not by the original 2026-05-04 audit. (C2.)

The F4 full path (SECURITY DEFINER `fetch_shared_list` + four-policy reshape) stays out of scope per its own audit text — "Significant work for an already-accepted risk; only do it if the threat model changes." A deeper F2 mitigation — server-enforced recent-auth on `delete_account()` — is also deferred; rationale is folded into C1's documentation since it's the natural place a future reader will go to look for it.

---

## Audit-stale closures

Each finding below is verified against current code/docs. No commit needed.

### F1 — High — HTTP security headers / CSP — **closed in Phase 1**

- `public/_headers` exists with all eight recommended directives (CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS, COOP). `connect-src` correctly points at the production Supabase project URL (`https://ichohopmuqdwbowsxpob.supabase.co` + wss).
- Phase 1 commit: `dc0b924`.

### F2 — Medium — Auth tokens in localStorage — **active in Phase 19** (see C1 below)

The token-storage default is unchanged (and accepted: grampacker is BaaS with no backend server in front, so cookie storage isn't a meaningful upgrade). What's still missing is the audit's explicit "document the residual risk in SECURITY.md once F1 is shipped" — F1 shipped in Phase 1; the SECURITY.md entry was never written. C1 closes that.

### F3 — Medium — Account deletion re-authentication — **closed in Phase 1 (UI-scoped)**

- `src/settings/SettingsPage.tsx:266-381` has the full two-stage flow: `TypedConfirmDialog` → password verification form → RPC. The `signInWithPassword` re-auth at line ~295-298 mirrors `ChangePasswordForm`. The error copy "Current password is incorrect." is generic per audit guidance.
- Phase 1 commit: `d196bf7`.
- **Scope of protection.** The re-auth is UI-side friction only. The `delete_account()` RPC at `supabase/migrations/20260426000000_delete_account_rpc.sql:11-15` checks only `auth.uid() is null` — a stolen authenticated JWT can invoke the RPC directly via PostgREST and bypass the UI gate entirely. That residual risk lives with F2 (localStorage tokens), not with F3. Closing F3 means the audit's specific UI recommendation is shipped; it does NOT mean account deletion is safe against stolen-session-token compromise.

### F4 — Low — `lists_public_select_shared` enumeration — **cheap path closed in Phase 10; full path deferred**

- Cheap path (copy clarification): `src/lists/PrivacyPanel.tsx:41` reads "Public — anyone can view this list, and public lists may be discoverable without the link." (`8eee620`, Phase 10).
- Full path (SECURITY DEFINER `fetch_shared_list` + reshape three other public-select policies): deferred per audit recommendation. Stays in the campaign deck.

### F5 — Low — `react/jsx-no-target-blank` — **closed in Phase 10**

- `CLAUDE.md` "What NOT to do" carries the guardrail bullet (`7016f39`). The single current `target="_blank"` site (`src/components/MarkdownPage.tsx:39`, JSX spread form) is already correctly paired with `rel="noopener noreferrer"`. The plugin install was deliberately skipped — linting one already-compliant site doesn't earn the dependency.

### F6 — Info — `MarkdownPage` configuration guard comment — **closed in Phase 1**

- `src/components/MarkdownPage.tsx:1-2` has the comment: "SAFETY: Do not enable rehype-raw or accept user-controlled content here. This component must continue to receive only build-time bundled markdown." Phase 1 commit: `2f356a2`.

### F7 — Info — Supabase dashboard config verification — **doc closed in Phase 10**

- `SECURITY.md` "Operational checklist (Supabase dashboard)" section captures the five items (access token TTL, refresh token rotation, reuse interval, redirect URL allowlist, Confirm email). Phase 10 commit: `aa42fd0`. The literal `Last verified: <YYYY-MM-DD by name>` line stays as a placeholder; the actual dashboard check remains a user-side task.

### F8 — Info — Service-worker URL-keyed cache — **closed in Phase 10 (no commit)**

- `vite.config.ts:27-31` already carried the URL-keyed-cache guardrail comment with the two future remediation paths. Phase 10 documented this as "closed by prior change."

### F9 — Info — `bulk_update_sort_order` no-dynamic-SQL — confirmation only.

- Migration `20260501000000` uses IF/ELSIF branches with hardcoded table identifiers. No SQL injection surface. No action.

### F10 — Info — No service-role keys in repo or bundle — confirmation only.

- `.env` is gitignored; `dist/assets/index-*.js` contains only the publishable anon prefix. No action.

### F11 — Info — `delete_account` `search_path` correction — confirmation only.

- Migration `20260505000000_fix_delete_account_search_path.sql` corrected `search_path` from `public` to `public, pg_temp` ahead of the audit. No action.

### F12 — Info — Vite build does not strip `console` calls — confirmation only (citation refreshed).

- The audit cited `src/App.tsx:27-29` (DEV-gated `console.error`). After Phase 18, the global mutation error path moved to `src/lib/mutation-error-handler.ts:32-49`, which logs `console.warn` in **every** environment by design (see the file's header comment — "Logged in every environment so production failures are visible…").
- Verified the structured payload at line 44-48 contains only: the mutation key (`mutation.options.mutationKey?.join('/')`), the error message string, and an optional error `code`. No tokens, no auth state, no PII. The mutation key is a static identifier (e.g. `'gear-items/delete'`), not user data.
- No action. F12's substance — "the only production console output is intentional and contains no sensitive data" — still holds; the production log site is now the structured mutation warning rather than the DEV-gated `App.tsx` line.

### F13 — Info — CSV import 2 MB cap + formula-injection neutralization — confirmation only.

- `src/lib/use-csv-file-input.ts:3` (size cap) and `src/lib/csv/core.ts` (formula prefix neutralization on export). No action.

---

## Active commit

### C1 — F2 — Document localStorage token residual risk in SECURITY.md

**Where:** Two edits to `SECURITY.md`.

**Edit 1 — New "Accepted residual risks" section.** Inserted **between** the existing "Defense-in-depth extras" section and the "Operational checklist (Supabase dashboard)" section. Single risk entry today; structured so future accepted-risk additions slot in.

**Why this placement:** The "Defense-in-depth extras" section already enumerates active mitigations (per-user resource caps, current-password re-auth, recovery-only `/reset-password`, query-level owner scoping). The natural counterpoint is a section that names the things we're explicitly *not* mitigating beyond what the architecture provides. Putting it just before the operational checklist keeps the "things humans should do" together at the bottom of the doc.

**Exact content to insert:** verbatim text below; do not edit-while-pasting. Place a `---` separator before and after as the existing section convention dictates.

```markdown
## Accepted residual risks

These are threats with no in-app mitigation today. Each is documented so a future reviewer can see what's been considered vs. what's been overlooked. If the threat model changes, the linked work moves into scope.

### Auth tokens in `localStorage`

The Supabase JS client uses `window.localStorage` for the JWT and refresh token by default (`src/lib/supabase.ts` calls `createClient` with no storage override). Any successful XSS in the authenticated app exfiltrates both tokens, granting the attacker the user's session for as long as the access token is valid (capped by the access-token TTL — see operational checklist) and indefinitely if the refresh token is also taken (until refresh-token rotation invalidates it).

**What we rely on instead:**

- **Content-Security-Policy** (`public/_headers`) — `script-src 'self'` plus the absence of `'unsafe-eval'`/`'unsafe-inline'` on `script-src` is the practical XSS mitigation. The CSP is the load-bearing control here, not the storage choice.
- **No XSS surfaces in the source tree today** — no `dangerouslySetInnerHTML`, no `innerHTML` writes, no `eval`, no `document.write`, no raw `fetch` to user-controlled URLs. `react-markdown` runs without `rehype-raw`. `MarkdownPage` carries a header comment pinning the safe configuration.
- **In-app password change requires current-password re-auth** — `ChangePasswordForm` calls `supabase.auth.signInWithPassword` with the current password before `updateUser({ password })`. This is a real protection: rotating the password requires knowing the current one, not just holding a session token. (The forgot-password recovery path requires the email-link recovery code instead — see "Defense-in-depth extras".)
- **Short access-token TTL** with refresh-token rotation (operational checklist) shrinks the window in which a stolen access token is useful.

**Where the localStorage assumption leaks beyond what the UI controls.** The Delete-account UI also re-auths with current password (`SettingsPage.tsx`'s `DeleteAccount` component), but that gate is client-side friction only. The `delete_account()` RPC itself only checks `auth.uid() is null` (`supabase/migrations/20260426000000_delete_account_rpc.sql`); a stolen authenticated JWT can call it directly through PostgREST and skip the UI entirely. The same property applies to every PostgREST endpoint and every authenticated SECURITY DEFINER RPC: the JWT itself is the access proof, not the UI flow that obtained it. Adding a server-enforced recent-auth proof to `delete_account()` (e.g. require a fresh `signInWithPassword` token signature passed as an RPC argument and verified server-side) would close this gap; it's deferred because (a) the BaaS architecture has no server-side place to verify a freshness claim other than another RPC roundtrip the attacker would also be holding the token for, and (b) the practical control is still "make XSS not happen" via CSP. Documented here so future reviewers see what the UI re-auth does and does not cover.

**Why we don't switch to cookie-based session storage.** A cookie-based store is only meaningfully more secure when there's a server-side component that can read the cookie and proxy to the database. grampacker is BaaS — the browser talks directly to PostgREST. Moving the session into a cookie under that architecture buys cookie-handling complexity without removing the XSS-exfiltration class (an attacker with script execution in the page can still call PostgREST as the user). The architecturally honest mitigation is "make XSS not happen" (CSP + no XSS surfaces in code), which we have.

**What would change this acceptance:**

- A `dangerouslySetInnerHTML` site or `rehype-raw` enable lands without removing the localStorage assumption — XSS surface reopens, residual risk converts to active risk.
- A backend service is introduced that could hold the session in an HttpOnly cookie. At that point cookie-based storage becomes the obvious choice.
- The CSP weakens (e.g. `'unsafe-inline'` on `script-src`, or a third-party script source added without subresource integrity).

See `REVIEW-security.md` finding F2 (2026-05-04 audit) and the F1 mitigation in `public/_headers`.
```

**Edit 2 — Soften the cascade-cleanup phrasing in "Defense-in-depth extras".** `SECURITY.md:143` currently reads:

- Old: `- **\`ON DELETE CASCADE\` chains.** \`auth.users\` → \`profiles\` → \`categories\` / \`gear_items\` / \`lists\`; \`gear_items\` → \`list_items\`; \`lists\` → \`list_items\`. Account deletion is comprehensive — \`delete_account()\` only needs to remove the \`auth.users\` row, the cascade does the rest.`
- New: `- **\`ON DELETE CASCADE\` chains.** \`auth.users\` → \`profiles\` → \`categories\` / \`gear_items\` / \`lists\`; \`gear_items\` → \`list_items\`; \`lists\` → \`list_items\`. The cascade is what makes account deletion comprehensive: \`delete_account()\` performs cleanup by removing the \`auth.users\` row, and the cascade does the rest. (\`delete_account()\` itself is a SECURITY DEFINER RPC whose only auth check is \`auth.uid() is null\` — see "Accepted residual risks" for what that does and does not gate against.)`

**Why this edit:** Edit 1 introduces the "stolen-JWT can call `delete_account()` directly" framing into the same doc that previously said `delete_account()` "only needs to remove" the `auth.users` row. The original wording was about cascade scope (the cleanup is comprehensive), but read alongside Edit 1's residual-risk text it can read as an over-strong claim about authorization. The replacement keeps the cascade-scope point intact and cross-references the new section so the auth-side caveat is one click away.

**Acceptance for C1:**

- New "Accepted residual risks" section exists between "Defense-in-depth extras" and "Operational checklist", with the exact text above and the two `---` separators.
- The cascade-cleanup bullet at SECURITY.md:143 reads exactly as the new wording above. The phrase "only needs to remove" no longer appears in `SECURITY.md`.
- No edits to other sections (operational checklist content unchanged, RLS table unchanged, SECURITY DEFINER inventory unchanged — that's C2's job).
- `git diff SECURITY.md` shows only these two changes.

**Verification:** `npm run build`, `npm run lint`, `npm test --run` (all should be no-ops since this is a markdown-only change; running them confirms the change didn't accidentally touch a code path).

**Commit message:**

```
docs(security): document localStorage token residual risk (F2)

Closes F2 from REVIEW-security.md by documenting the residual risk
the audit identified — auth tokens live in localStorage by Supabase
default, so any successful XSS is a session-takeover. Documents what
we rely on instead (CSP + no XSS surfaces + in-app password re-auth
+ short token TTL), where the UI re-auth gates do NOT extend to
direct PostgREST/RPC calls (delete_account checks only auth.uid),
why cookie-based storage isn't pursued under the BaaS architecture,
and what would change the acceptance.

Also softens the cascade-cleanup bullet in "Defense-in-depth extras"
so it no longer reads as "delete_account only needs to remove
auth.users" alongside the new residual-risk text — the cascade-scope
point stays intact and now cross-references the new section.
```

### C2 — Refresh SECURITY.md SECURITY DEFINER inventory (Phase 8 RPCs missing)

**Why this commit exists:** Phase 19's job is to close `REVIEW-security.md`. Closing the audit while `SECURITY.md` still claims "four functions total" — when there are seven — is the wrong shape of closure. The three Phase 8 consolidated-mutation RPCs (`add_gear_item_with_list_item`, `create_list_from_selection`, `duplicate_list`) from migration `20260510000000_add_consolidated_mutation_rpcs.sql` are SECURITY DEFINER, granted to `authenticated`, and carry the same `auth.uid() <> p_user_id` + per-id ownership checks as `bulk_update_sort_order`. They belong in the inventory.

**Where:** Four edits to `SECURITY.md`.

**Edit 1 — Section count.** `SECURITY.md:103`:

- Old: `We use it sparingly — four functions total — and every one of them is structured to preserve the security boundary despite the bypass.`
- New: `We use it sparingly — seven functions total — and every one of them is structured to preserve the security boundary despite the bypass.`

**Edit 2 — Inventory table.** `SECURITY.md:118-126`. Append three new rows to the table immediately after the existing `bulk_update_sort_order` row and before the `rls_auto_enable` row (preserving the user-callable / trigger-only grouping the table already has):

```markdown
| `add_gear_item_with_list_item(...)` | User-callable RPC for the /lists/:id "+ Add new item" flow. Inserts a `gear_items` row and a `list_items` row referencing it in one transaction. | `authenticated` only. | `auth.uid() <> p_user_id` raises `42501`; defense-in-depth `EXISTS` checks raise `P0002` before any insert — that `p_list_id` is owned by `p_user_id`, and (when non-null) that `p_category_id` is owned by `p_user_id`. The category check is added by the patch migration; without it, RLS bypass inside `DEFINER` would let a forged `p_category_id` through to the composite-FK rollback path with a less clear error. | `20260510000000` (function shape), patched in `20260510000001` (category ownership check) |
| `create_list_from_selection(...)` | User-callable RPC for the /gear "Create list from selection" multi-select flow. Inserts a `lists` row and bulk-inserts `list_items` referencing the supplied `gear_item_ids`. | `authenticated` only. | `auth.uid() <> p_user_id` raises `42501`; per-id ownership check on every supplied `p_gear_item_ids` element (count of owned ids must equal input count) raises `P0002` before the parent insert. | `20260510000000` |
| `duplicate_list(...)` | User-callable RPC for the /lists "Duplicate" kebab. Copies a `lists` row (name suffixed " (copy)") and every owned `list_items` row from source to new in one transaction. | `authenticated` only. | `auth.uid() <> p_user_id` raises `42501`; explicit `select … where id = p_source_list_id and user_id = p_user_id` raises `P0002` if the source list isn't owned by the caller. | `20260510000000` |
```

**Edit 3 — Accepted-linter-warning section.** `SECURITY.md:131`:

- Old: `We accept the warning deliberately on \`delete_account()\` and \`bulk_update_sort_order()\`. The full reasoning — including why each of the linter's three suggested remediations (revoke EXECUTE, switch to \`SECURITY INVOKER\`, move out of the \`public\` schema) breaks the feature without addressing a real risk — lives in \`DECISIONS.md\` ADR 3 under "Accepted linter warning". When the linter raises this warning on a new function, decide between accepting (and document the rationale alongside ADR 3's pattern) or refactoring away from \`DEFINER\`. Don't silently leave it.`
- New: `We accept the warning deliberately on the five user-callable definers: \`delete_account()\`, \`bulk_update_sort_order()\`, \`add_gear_item_with_list_item()\`, \`create_list_from_selection()\`, and \`duplicate_list()\`. The full reasoning — including why each of the linter's three suggested remediations (revoke EXECUTE, switch to \`SECURITY INVOKER\`, move out of the \`public\` schema) breaks the feature without addressing a real risk — lives in \`DECISIONS.md\` ADR 3 under "Accepted linter warning". The same pattern (search_path pinned, EXECUTE granted to \`authenticated\` only, inline \`auth.uid()\` ownership check + per-row ownership re-verification, trust assumption documented in the migration header) applies uniformly across all five. When the linter raises this warning on a new function, decide between accepting (and document the rationale alongside ADR 3's pattern) or refactoring away from \`DEFINER\`. Don't silently leave it.`

**Edit 4 — Roles section.** `SECURITY.md:72`:

- Old: `- **\`authenticated\`** — signed-in users. Reads / writes via the owner policies. Has \`EXECUTE\` on the SECURITY DEFINER RPCs we expose (\`delete_account\`, \`bulk_update_sort_order\`).`
- New: `- **\`authenticated\`** — signed-in users. Reads / writes via the owner policies. Has \`EXECUTE\` on the five user-callable SECURITY DEFINER RPCs we expose: \`delete_account\`, \`bulk_update_sort_order\`, \`add_gear_item_with_list_item\`, \`create_list_from_selection\`, \`duplicate_list\`. (The two trigger-only definers — \`handle_new_user\`, \`rls_auto_enable\` — have EXECUTE revoked from all roles; triggers fire regardless of EXECUTE privileges.)`

**Acceptance:**

- The phrase "four functions total" no longer appears anywhere in `SECURITY.md`. Replaced with "seven functions total" exactly once at line 103.
- Inventory table contains seven rows (vs. current four). Header row unchanged.
- The new rows preserve the existing column shape: `Function | Purpose | EXECUTE | Inline check | Migration`.
- The migration ref `20260510000000` appears in all three of the new rows; `20260510000001` appears in the `add_gear_item_with_list_item` row alongside it.
- The accepted-linter-warning section names all five user-callable definers (the two trigger-only definers, `handle_new_user` and `rls_auto_enable`, are not user-callable and don't trigger the linter warning under the same shape — leave them out of this list).
- The Roles section's `authenticated` bullet lists the same five user-callable definers.
- `git diff SECURITY.md` shows only these additions/edits; no drift in other sections.

**Verification:** `npm run build`, `npm run lint`, `npm test --run` (markdown-only change; running the gates confirms no accidental code-path drift).

**Commit message:**

```
docs(security): refresh SECURITY DEFINER inventory for Phase 8 RPCs

Phase 8 (migration 20260510000000) added three consolidated-mutation
RPCs that were never reflected in SECURITY.md's inventory:
- add_gear_item_with_list_item
- create_list_from_selection
- duplicate_list

All three follow the bulk_update_sort_order pattern: search_path
pinned to (public, pg_temp), EXECUTE revoked from public/anon and
granted to authenticated only, auth.uid() <> p_user_id raised as
42501, per-id ownership re-verification before any insert.

Updates the function count (four → seven), adds three rows to the
inventory table, and extends the accepted-linter-warning section
to name all five user-callable definers (the two trigger-only
definers don't trigger the warning under the same shape).

Closes the inventory drift before REVIEW-security.md is closed as
a campaign artifact.
```

---

## Deferred (stays in the campaign deck)

- **F4 full path** — SECURITY DEFINER `fetch_shared_list(p_slug)` RPC + revoke `anon` SELECT on `lists` + reshape `list_items_public_select_shared` / `gear_items_public_select_via_shared_list` / `categories_public_select_via_shared_list`. Significant migration + RPC + four-policy reshape. Only if the threat model changes (e.g. a public directory becomes a competitive concern, or shared-list slugs need to be unguessable as a credential rather than a URL handle). Cheap-path copy fix already shipped in Phase 10.

---

## Out of scope

- **Cookie-based session storage.** Discussed in C1's documentation; not pursued because the BaaS architecture doesn't make it a meaningful upgrade.
- **eslint-plugin-react install for `jsx-no-target-blank`.** Deferred deliberately in Phase 10. One compliant site doesn't earn the dependency. CLAUDE.md guardrail covers the rule.
- **Service-worker auth-keyed cache.** Documented as accepted under solo-user assumption (F8). Future work if the assumption breaks.
- **The literal `Last verified:` line in SECURITY.md operational checklist.** That's a user-side dashboard task, not a code change.

---

## Verification gates

After C1:

- `npm run build` — pass.
- `npm run lint` — pass.
- `npm test --run` — full suite (101 tests) green; markdown-only change so this is a no-op gate, but running it confirms no accidental drift.
- `git diff SECURITY.md` — shows the additive `## Accepted residual risks` block AND the cascade-cleanup wording change at line 143. No other drift.
- `grep -c "only needs to remove" SECURITY.md` — returns 0.
- `grep -c "Accepted residual risks" SECURITY.md` — returns at least 1 (the new heading).

After C2:

- `npm run build` / `npm run lint` / `npm test --run` — same no-op gates; markdown-only.
- `git diff SECURITY.md` — shows the four edits described under C2 (count line, three new inventory rows, linter-warning sentence, Roles section bullet). No other drift.
- `grep -c "four functions total" SECURITY.md` — returns 0.
- `grep -E "^\| \`(add_gear_item_with_list_item|create_list_from_selection|duplicate_list)" SECURITY.md | wc -l` — returns 3.
- `grep -c "add_gear_item_with_list_item" SECURITY.md` — returns at least 3 (one each in the Roles bullet, the inventory row, and the linter-warning sentence).

After Phase 19 closes, append a Phase 19 summary to `REVIEW-FIX.md` matching the existing format:

- "Shipped" — C1 (F2 residual-risk doc) + C2 (SECURITY DEFINER inventory refresh).
- "Audit closures" — list the 12 findings closed (F1, F3, F4 cheap path, F5, F6, F7, F8, F9, F10, F11, F12, F13) with their commit references and Phase 19's F2 doc add. Note that F3's closure is UI-scoped only — server-side direct-RPC access remains under F2's residual-risk umbrella.
- "Deferred" — F4 full path with its trigger conditions; server-enforced recent-auth on `delete_account()` (noted in C1's text) as a deeper future step if the F2 acceptance changes.
- "Campaign milestone" — `REVIEW-security.md` is fully closed as a campaign artifact (modulo F4 full-path, which is the same status as it had after Phase 10).
- "Next phase" — `REVIEW-performance.md`.

---

## Risk register

- **Risk:** I miscount what's already shipped. Mitigation: every closure above cites either a commit ref from `REVIEW-FIX.md` or a current-state file:line that I read this session. F1 verified by reading `public/_headers`. F3 verified by reading `src/settings/SettingsPage.tsx:266-381` and `supabase/migrations/20260426000000_delete_account_rpc.sql:11-15` (UI-scoped distinction added after Codex). F4 cheap by reading `src/lists/PrivacyPanel.tsx:41`. F5 by reading `CLAUDE.md`. F6 by reading `src/components/MarkdownPage.tsx:1-2`. F7 by reading `SECURITY.md`'s operational-checklist section. F8 by the existing comment in `vite.config.ts:27-31`. F11 by migration filename in `supabase/migrations/`. F12 evidence updated post-Codex to cite `src/lib/mutation-error-handler.ts:32-49` (the post-Phase-18 production log site) instead of the audit's stale `src/App.tsx:27-29` reference.
- **Risk:** the F2 doc text is too long and SECURITY.md grows unwieldy. Mitigation: the doc currently runs ~250 lines; the new section is ~40 lines after the BaaS-direct-RPC-access caveat was added. The existing "Defense-in-depth extras" section is denser per line and already runs ~30 lines. Comparable density.
- **Risk:** F2 doc accidentally implies stronger enforcement than exists. Mitigation: the "Where the localStorage assumption leaks beyond what the UI controls" paragraph names the gap explicitly — UI re-auth on Delete-account is friction only; `delete_account()` checks `auth.uid()` and a stolen JWT bypasses the UI. The "in-app password change" bullet stays in the "what we rely on instead" list because the password-change flow's gate IS server-enforceable (the new password requires the old password to be supplied to `signInWithPassword` server-side); account deletion is called out separately as the case where the UI gate doesn't extend to the server.
- **Risk:** "what would change this acceptance" reads as an invitation to weaken the CSP. Mitigation: the third bullet is phrased as the *trigger* for re-evaluation, not as a list of acceptable changes. The bullet says "the CSP weakens … residual risk converts to active risk" — that's the point.
- **Risk:** C2's inventory edits drift from the migration's exact function shapes. Mitigation: each new inventory row's "Inline check" column is paraphrased from the migration source I read this session. For `add_gear_item_with_list_item`, the current function body is the patched version in `supabase/migrations/20260510000001_fix_add_gear_item_category_ownership.sql:44-63` (auth check at `:44`, list-ownership check at `:50-54`, category-ownership check at `:59-63`); `20260510000000` has the original function shape minus the category check. The inventory row mentions both migrations and explains what the patch added. For `create_list_from_selection` and `duplicate_list`, the current function body is `20260510000000_add_consolidated_mutation_rpcs.sql:116-138` and `:185-197` respectively. Error codes (`42501`, `P0002`) come directly from the `using errcode = …` clauses.
- **Risk:** the C1 cascade-cleanup softening reads as a contradiction next to the residual-risk section. Mitigation: the new wording keeps the cascade-scope claim ("the cascade is what makes account deletion comprehensive") and adds a parenthetical that cross-references the residual-risk section. Reader picks up "comprehensive cleanup once the deletion fires" + "but the deletion can fire from any authenticated JWT" — that's the actual security posture, not a contradiction.
- **Risk:** repeating Phase 10's commit refs in Phase 19's summary makes `REVIEW-FIX.md` look duplicate. Mitigation: cite them with "(Phase N, `<sha>`)" annotations and frame the section as "audit closures from across the campaign", not "Phase 19 commits". The Phase 19 summary's "Shipped" section has two entries: C1 and C2.

---

## Pre-execution checklist

- [ ] User has approved this spec.
- [ ] Codex review of this spec is complete and any findings have been patched into this file.
- [ ] No staged or unstaged changes outside this file.
- [ ] Working from `main` with the recent push verified.
