# grampacker — Phase 1 fixes (2026-05-04)

**Source:** synthesized from `REVIEW-quality.md`, `REVIEW-security.md`, `REVIEW-performance.md`.
**Scope:** five small, high-leverage, independent fixes — pre-selected for low risk and high signal.
**Mode:** atomic commits, one per fix. No refactors. No drive-by changes.

> **Note on file paths:** the original audits used absolute paths from a different machine (`/Users/joe/code/grampacker/...`). All paths in this document are repo-relative.

---

## How to execute this file

These five items are independent and can be done in any order. The recommended order below puts the lowest-risk changes first (additive only) and the logic-touching changes last.

For each item:
1. Make the change exactly as specified.
2. Run `npm run typecheck` (or whatever the project's TS gate is) and fix any new errors.
3. If a test is specified, write the test and confirm it passes.
4. Commit with the suggested message.
5. Move to the next item.

After all five: produce a `REVIEW-FIX.md` summary with one section per item, listing the commit hash and the verification result.

---

## P1-1 — Add HTTP security headers via `public/_headers`

**Origin:** REVIEW-security.md F1 (High).

**Why:** The deployed Cloudflare Pages site ships no app-level security headers. Adding a `_headers` file is a single new file with no risk to existing code, and it's the practical mitigation for the localStorage-token risk (F2). Cloudflare Pages reads `public/_headers` verbatim — no wrangler config required.

**Change:** create new file `public/_headers` with the following exact content:

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

**Notes embedded in the audit (do not modify):**
- `connect-src` includes the Supabase project URL for both REST and realtime (wss).
- `'unsafe-inline'` on `style-src` is required because Tailwind injects styles via inline `<style>`.
- `frame-ancestors 'none'` plus `X-Frame-Options: DENY` are deliberately redundant.
- `worker-src 'self'` covers the PWA service worker (`sw.js`).

**Verification:**
- File exists at `public/_headers`.
- Local build (`npm run build`) does not error.
- After the next deploy, `curl -I https://<your-pages-url>/` shows the headers in the response.

**Acceptance criteria:** file exists with exactly the content above. Build passes.

**Suggested commit:** `security: add CSP and security headers via public/_headers (F1)`

---

## P1-2 — Pin `MarkdownPage` safe configuration with a guard comment

**Origin:** REVIEW-security.md F6 (Info).

**Why:** `MarkdownPage` is currently safe (no `rehype-raw`, content fed via build-time `?raw` imports). A one-line comment locks the configuration against a future drift turning it into a user-content XSS surface. Trivial change, defense-in-depth value.

**File:** `src/components/MarkdownPage.tsx`

**Change:** add a header comment at the top of the file (above any imports) with this exact wording:

```ts
// SAFETY: Do not enable rehype-raw or accept user-controlled content here.
// This component must continue to receive only build-time bundled markdown.
```

**Verification:** comment is present at the top of the file. No code changes.

**Acceptance criteria:** the comment is the first non-blank line of the file.

**Suggested commit:** `docs: pin MarkdownPage safe configuration (F6)`

---

## P1-3 — Add `[onClose]` deps to `usePortalPopover` effect

**Origin:** REVIEW-performance.md M10 (Medium).

**Why:** the effect that updates `onCloseRef` runs on every render with no deps. With ~300 list items + 500 gear items mounted, that's ~800 scheduled passive-effect tasks per render. During reorder drags, every row re-renders continuously. One-line fix.

**File:** `src/lib/use-portal-popover.ts` around line 49–51.

**Current code:**
```ts
useEffect(() => { onCloseRef.current = onClose })   // no deps — runs every render
```

**Replace with:**
```ts
useEffect(() => { onCloseRef.current = onClose }, [onClose])
```

**Verification:**
- Typecheck passes.
- Manual smoke: open and close any kebab popover — still dismisses on outside click and on the configured triggers (escape, scroll if enabled).
- If the project has a test for `usePortalPopover`, it still passes.

**Acceptance criteria:** the effect now has `[onClose]` as its deps array. No other behavior change.

**Suggested commit:** `perf: stabilize usePortalPopover effect deps (M10)`

---

## P1-4 — `WeightTable` routes orphan category ids to Uncategorized

**Origin:** REVIEW-quality.md B-1 (BLOCKER).

**Why:** `WeightTable` accumulates per-category grams keyed on the raw `item.gear_item.category_id`, then iterates `categories` and only emits rows where `basePerCat.has(c.id)`. An item whose `category_id` is non-null but not in the passed-in `categories` accumulates under an orphan key, is never read, and never sums into `baseGrams`. The headline pack-weight number silently drops grams in any cache-drift window between `['categories']` and `['list-items']`. `groupListItemsByCategory` already handles this (`src/lib/grouping.ts:28-30`); `WeightTable` does not.

**File:** `src/lists/WeightTable.tsx` around lines 25–45.

**Change:** in the loop that accumulates `basePerCat`, route unknown category ids to the `null` (Uncategorized) bucket. The replacement loop should match this shape:

```ts
for (const item of items) {
  const w = item.gear_item.weight_grams * item.quantity
  if (item.is_consumable) {
    consumableGrams += w
  } else if (item.is_worn) {
    wornGrams += w
  } else {
    const raw = item.gear_item.category_id
    const key = raw !== null && categories.some((c) => c.id === raw) ? raw : null
    basePerCat.set(key, (basePerCat.get(key) ?? 0) + w)
  }
}
```

The precedence (consumable beats worn beats base) matches the existing branch order; the DB enforces mutual exclusion of `is_consumable`/`is_worn`. Do NOT change the precedence.

**Test (REQUIRED — `WeightTable` currently has no test at all):**

Create `src/lists/WeightTable.test.tsx` (or whatever the project's test file convention is for this directory). Cover at minimum:

1. **Orphan category contributes to base weight.** Given a `listItems` array containing an item whose `gear_item.category_id` is `'orphan-uuid'` and a `categories` array that does NOT include that id, the rendered total `baseGrams` MUST equal that item's `weight_grams * quantity`. (This is the regression test for B-1.)
2. **Quantity multiplier.** Item with `weight_grams: 100` and `quantity: 3` contributes 300 grams to base.
3. **Empty `items` returns null.** (Match the existing `if (items.length === 0) return null` behavior; see also nit N-2 in REVIEW-quality.md, which is OUT OF SCOPE for this fix — just preserve current behavior.)

**Verification:**
- All three tests pass.
- All existing tests still pass.
- Typecheck passes.

**Acceptance criteria:** the regression test for orphan categories passes, AND the production code change is in place. Both required.

**Suggested commit:** `fix(WeightTable): route orphan category ids to Uncategorized (B-1)`

---

## P1-5 — Re-authenticate before `delete_account`

**Origin:** REVIEW-security.md F3 (Medium).

**Why:** `delete_account()` checks only `if auth.uid() is null` and then permanently deletes the user. There is no soft delete or recovery. The frontend gate (`TypedConfirmDialog` requiring the user to type "delete") is friction for an honest user, not protection against a stolen session. The asymmetry is the finding: the in-app password change 150 lines up in the same file (`ChangePasswordForm`) DOES require current-password re-auth. Mirror that pattern.

**File:** `src/settings/SettingsPage.tsx` — the `DeleteAccount` component around line 258, and the surrounding form/state.

**Change:** add a current-password input to the delete-account flow, and verify it via `signInWithPassword` before calling the `delete_account` RPC. Pattern to mirror: `ChangePasswordForm` in the same file (around line 117).

The verification block must look like this:

```ts
const { error: verifyError } = await supabase.auth.signInWithPassword({
  email: session.user.email!,
  password: currentPassword,
})
if (verifyError) {
  setErr('Current password is incorrect.')
  return
}
const { error } = await supabase.rpc('delete_account')
```

**Important:**
- Surface a generic `'Current password is incorrect.'` rather than verbatim Supabase errors. This matches the password-change flow's handling.
- Keep the existing `TypedConfirmDialog` ("type 'delete'") gate — the password is added as a SECOND gate, not a replacement.
- Do NOT touch the `delete_account` RPC itself in this phase. The audit explicitly recommends frontend-only re-auth here. (The DB-side check is a separate, larger conversation.)
- Do NOT modify `ChangePasswordForm`. It is the reference pattern, untouched.

**Verification:**
- Typecheck passes.
- Manual smoke: opening "Delete account" now shows a current-password field. Typing "delete" + a wrong password surfaces "Current password is incorrect." and does NOT delete. Typing "delete" + the correct password deletes the account.
- (If the project has e2e tests covering this flow, update them. If not, do NOT add e2e tests in this phase — out of scope.)

**Acceptance criteria:** the delete-account flow requires both the typed-confirmation gate AND a correct current password before the RPC call. Wrong password shows the generic error. RPC is unchanged.

**Suggested commit:** `security: require current-password re-auth on delete account (F3)`

---

## Out of scope for Phase 1

These items appear in the audits but are explicitly NOT part of this phase. Do not start them. Do not "drive-by" fix them. They are tracked for later phases:

- B-2, B-3, B-4 (cache invalidation / optimistic helpers cluster) — Phase 2.
- H1, M1 (database indexes) — Phase 4.
- H4, H5, H6, L7 (bundle splitting) — Phase 3.
- M6, M7, M8, M11, M12, L1, L2, L9 (render perf cluster) — Phase 5.
- W-1 (extract `useAnchoredMenu`) and other refactors — Phase 6.
- All test gaps T-2 through T-9 — Phase 7. (T-1 is partially addressed by P1-4 above, intentionally.)
- F2 (localStorage tokens documentation) — separate doc-only task.
- F4 (slug enumeration copy tightening) — separate small UX task.
- F5 (`react/jsx-no-target-blank` ESLint rule) — separate tooling task.
- F7 (Supabase dashboard verification) — manual, no code.

If anything you encounter while making Phase 1 changes seems to require touching out-of-scope code, STOP and surface it in the `REVIEW-FIX.md` summary as a "blocker" rather than expanding scope.

---

## Final summary

After all five fixes land, produce `REVIEW-FIX.md` with this structure:

```markdown
# grampacker — Phase 1 fix summary (DATE)

## Shipped
- P1-1 (F1): commit <hash> — public/_headers added.
- P1-2 (F6): commit <hash> — MarkdownPage guard comment.
- P1-3 (M10): commit <hash> — usePortalPopover deps fixed.
- P1-4 (B-1): commit <hash> — WeightTable orphan category fix + test.
- P1-5 (F3): commit <hash> — delete-account current-password re-auth.

## Verification results
- typecheck: pass
- existing tests: pass
- new WeightTable test: pass
- manual smoke (delete account flow, popover dismiss): pass

## Blockers / surprises
- (none, or list anything that surfaced)

## Next phase
Phase 2: cache invalidation cluster (B-2, B-3, B-4, H2, H3) — see plan in chat history.
```

That's the deliverable. Five commits, one summary file. Total scope: ~50 lines of production code changed plus one test file plus one new headers file.
