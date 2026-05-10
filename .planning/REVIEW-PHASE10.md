# grampacker — Phase 10 fixes (2026-05-05)

**Source:** `REVIEW-security.md` — F4 (cheap path) + F5 + F7 + F8 (verification only).
**Scope:** small security-hardening pass. Three doc/copy commits + one operational checklist + summary. **Five commits, NO database migration, NO behavior change beyond a UI copy adjustment.**
**Why this is one phase:** all four items are guardrail-class. F4's full SECURITY DEFINER fix is explicitly out of scope per the audit's own recommendation ("only do it if the threat model changes"); the cheap copy tightening makes the existing accepted-risk surface honest with users. F5/F8 are pure code-comment guardrails. F7 is dashboard verification — captured here so the work is discoverable rather than living in someone's head.

> **Note on file paths:** all paths are repo-relative.
> **Phase 9 baseline:** main bundle = **187.32 KB gzip**. Bundle delta expected: 0 (only one user-facing string change; everything else is comments / docs / config-adjacent).
> **Risk profile:** very low. One copy change; the rest is documentation.

---

## How to execute this file

Five commits. Order doesn't matter — none depend on each other.

For each commit:
1. Make the change.
2. Run `npm run build` — pass.
3. Run `npm run lint` — pass.
4. Run `npm test --run` — 32 passed | 4 skipped (unchanged from Phase 9).
5. Manual smoke per the commit's verification section (mostly trivial).

---

## Commit 1 — F4 (cheap path): tighten PrivacyPanel copy to make the enumeration property honest

**Origin:** `REVIEW-security.md` F4 (Low — already accepted, but user-facing copy is misleading).

**Why:**

`lists_public_select_shared` is `using (is_shared = true)` with no slug constraint. An anon caller can `GET /rest/v1/lists?is_shared=eq.true&select=slug` and pull every currently-shared slug. The audit and `SECURITY.md` already accept this risk: "shared = opt-in public-readable, sharing fundamentally is enumeration."

But `src/lists/PrivacyPanel.tsx:40` says *"Anyone with this link can view the list"* — implying the link is required to find the list. It isn't. The copy is misleading; tightening it to call out the directory-listing nature is a one-line honest-disclosure fix that doesn't change behavior, only what the user understands they're opting into.

**Files:**

- Modify: `src/lists/PrivacyPanel.tsx:40`

**What to do:**

Replace the existing `<p>` text:

```tsx
// Before:
<p className="text-xs text-gray-500 mb-2">Anyone with this link can view the list.</p>

// After:
<p className="text-xs text-gray-500 mb-2">
  Public — anyone can view this list, and public lists may be discoverable without the link.
</p>
```

The "may be discoverable without the link" wording is deliberately precise: there's no visible public directory in the app today; the risk is API-level enumeration of shared slugs (anon caller hitting `GET /rest/v1/lists?is_shared=eq.true&select=slug`). Saying "discoverable by anyone browsing public links" would falsely imply a visible directory. Saying just "anyone with this link" understates the enumeration. The chosen wording correctly conveys "link is not the gate" without claiming a directory that doesn't exist.

**KNOWN RISK:** if the user prefers a different shape, surface alternatives — but stay away from any phrasing that asserts a public directory UI.

**Verification:**

- Build + lint + tests pass.
- Manual smoke:
  1. Open a list's privacy panel. Toggle public on. Confirm the new copy renders, no layout shift on the panel.
  2. Verify the existing share-link copy + button still work — this commit is copy-only inside the same `<p>`, no other JSX changes.

**Acceptance criteria:** copy honestly describes the public/discoverable nature; behavior unchanged.

**Suggested commit:** `docs(privacy): tighten public-link copy to surface enumeration property (F4)`

---

## Commit 2 — F5: add a CLAUDE.md guardrail note for `target="_blank"` + `rel="noopener noreferrer"`

**Origin:** `REVIEW-security.md` F5 (Low — future-proofing).

**Why:**

The audit recommended adding `react/jsx-no-target-blank` from `eslint-plugin-react`. Two reasons to skip the plugin:

1. The codebase has exactly **one** current `target="_blank"` site: `src/components/MarkdownPage.tsx:39`, which opens external markdown links via a JSX spread (`{...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}`) — already correctly paired with `rel="noopener noreferrer"`. (A literal-attribute grep returns zero hits because the spread form hides the attribute name; the safe pairing is in place.) Adding a plugin to lint a single site that's already compliant is mechanical bloat.
2. Modern browsers default `target="_blank"` to `noopener` since ~2020. The risk is small to begin with.

The right-sized response is a `CLAUDE.md` "What NOT to do" note so the rule is captured for future work without dragging in a plugin.

**Files:**

- Modify: `CLAUDE.md` — append a one-liner under "What NOT to do".

**What to do:**

Add to the existing "What NOT to do" list in `CLAUDE.md`:

```markdown
- Don't add `target="_blank"` without `rel="noopener noreferrer"` on the same anchor. Modern browsers default to `noopener` for `_blank`, but explicit `rel` is the codebase convention and removes the silent dependency on the browser default. The only current site is `src/components/MarkdownPage.tsx`'s external-link branch (already correctly paired); this rule keeps any future site honest.
```

Insert it in the existing list — order doesn't matter.

**Verification:**

- Build + lint + tests pass (no code change).
- Visual check: `CLAUDE.md` "What NOT to do" section now contains the new bullet.

**Acceptance criteria:** rule captured in human-readable form; no plugin added.

**Suggested commit:** `docs(claude): add target=_blank rel=noopener guardrail to "What NOT to do" (F5)`

---

## Commit 3 — F7: capture the Supabase dashboard verification checklist in SECURITY.md

**Origin:** `REVIEW-security.md` F7 (Info — needs dashboard access).

**Why:**

F7 lists five Supabase dashboard settings to verify (access token TTL, refresh token rotation, reuse interval, redirect URL allowlist, "Confirm email"). None require code changes — they're configuration on the Supabase project. But the verification list lives only in REVIEW-security.md today, which is a one-off audit document. As the project grows or changes hands, the verification can drift. Capturing it as an operational checklist in `SECURITY.md` makes it discoverable on every onboarding and easy to revisit.

The change is doc-only: the actual dashboard verification remains a user-side task and IS NOT performed by this commit.

**Files:**

- Modify: `SECURITY.md` — add a new section after the existing "Defense-in-depth extras" or near "When the model needs to change".

**What to do:**

Add a section to `SECURITY.md`:

```markdown
## Operational checklist (Supabase dashboard)

These are configuration knobs in the Supabase project dashboard. Code can't enforce them; engineers should verify them periodically (and during onboarding) since drift is silent.

- [ ] **Access token TTL ≤ 1 hour.** Project → Authentication → Sessions.
- [ ] **Refresh token rotation enabled.** Same panel.
- [ ] **Refresh token "reuse interval" short** (10–30 seconds is typical). Same panel.
- [ ] **Redirect URL allowlist** contains only known origins (production domain + `localhost` ports used in dev). Project → Authentication → URL Configuration.
- [ ] **"Confirm email" enabled.** Project → Authentication → Providers → Email. The login flow at `LoginPage.tsx` already handles the "email not confirmed" error path; if this gets disabled, the dead branch becomes a security gap.

Last verified: <YYYY-MM-DD by name>. Re-verify after any Supabase plan/project migration or when adding a new redirect URL.
```

Leave the "Last verified" line as a literal placeholder for the user to fill in after they perform the verification — the commit doesn't claim verification was done.

**Verification:**

- Build + lint + tests pass (no code change).
- `SECURITY.md` renders the new section cleanly.

**Acceptance criteria:** checklist captured in `SECURITY.md`; user has a single discoverable place to track the verification status.

**Suggested commit:** `docs(security): capture Supabase dashboard operational checklist (F7)`

---

## Commit 4 — F8: confirm vite.config.ts SW-cache assumption comment is current (likely no-op)

**Origin:** `REVIEW-security.md` F8 (Info — already documented in code).

**Why:**

The audit recommended pinning the URL-keyed SW cache assumption with a code comment. Verified: `vite.config.ts:27-31` already has the guardrail block:

```ts
// Cache is URL-keyed, not auth-keyed. Assumes single-user-per-
// browser. If grampacker ever supports multiple users on shared
// devices, either implement cacheKeyWillBeUsed to mix the auth
// subject into the key, or clear caches on logout. Solo-user
// today; revisit when assumption changes.
```

That's exactly what F8 asks for. **This commit is likely a no-op closure** — verify the comment is still in place and matches the F8 recommendation, and if so, no code change is needed; just record in REVIEW-FIX.md that F8 is closed by the existing comment (which predates this phase).

**Files:**

- Read-only: `vite.config.ts` (verify lines 27-31 still match).

**What to do:**

### Step 1 — verify the existing comment

```sh
sed -n '25,35p' vite.config.ts
```

Expect to see the URL-keyed-cache comment block. If present and unchanged, **no commit is needed for F8 itself** — it's closed by an earlier change. Skip ahead to Commit 5 and document closure there.

### Step 2 (only if the comment is missing or has drifted)

If for any reason the comment has been removed or substantively altered, restore the F8 guardrail wording:

```ts
// Cache is URL-keyed, not auth-keyed. Assumes single-user-per-
// browser. If grampacker ever supports multiple users on shared
// devices, either implement cacheKeyWillBeUsed to mix the auth
// subject (sub claim) into the key, or call
// caches.delete('supabase-rest') on signOut. Solo-user today;
// revisit when the assumption changes.
```

**Verification:**

- Build + lint + tests pass (no change in the no-op case).

**Acceptance criteria:** F8's recommended guardrail comment is present in `vite.config.ts`. If it was already there, no commit; document closure in Commit 5.

**Suggested commit (only if a change is needed):** `docs(vite): reinforce SW cache assumption comment (F8)`

---

## Commit 5 — Append Phase 10 summary to REVIEW-FIX.md

**File:** `.planning/REVIEW-FIX.md`

```markdown
# grampacker — Phase 10 fix summary (2026-05-05)

## Shipped

- **Commit 1 (F4 cheap path) — `<hash>`** — `src/lists/PrivacyPanel.tsx` copy tightened to call out that public lists are discoverable, not just link-gated. Behavior unchanged; honest disclosure restored. The full SECURITY DEFINER fix (revoke anon SELECT, route public reads through `fetch_shared_list` RPC, reshape three other policies) remains out of scope per the audit's own recommendation — only worth doing if the threat model changes.
- **Commit 2 (F5) — `<hash>`** — `CLAUDE.md` "What NOT to do" gained a guardrail bullet for `target="_blank"` + `rel="noopener noreferrer"`. Did NOT install `eslint-plugin-react`: the codebase has exactly one current `target="_blank"` site — `src/components/MarkdownPage.tsx`'s external-link branch (JSX spread form, already correctly paired with `rel="noopener noreferrer"`). Plus modern browsers default `target="_blank"` to `noopener`. Linting one already-compliant site doesn't earn the plugin install; the CLAUDE.md bullet is right-sized for the risk.
- **Commit 3 (F7) — `<hash>`** — `SECURITY.md` gained an "Operational checklist" capturing the five Supabase dashboard verifications. Doc-only; the actual dashboard verification is a user-side task and is recorded with a `Last verified` line for ongoing tracking.
- **Commit 4 (F8) — closed by prior change.** Verified `vite.config.ts:27-31` already contains an SW-cache URL-keyed guardrail comment that matches the **substance** of the F8 recommendation (single-user-per-browser assumption + the two remediation paths if it changes). The wording differs slightly from the audit's literal suggestion (the existing comment says "clear caches on logout" where the audit example said `caches.delete('supabase-rest')`), but the intent is the same. No new commit; closure documented here.

## Verification results

- `npm run build`: pass; bundle gzip 187.32 KB → 187.32 KB (one user-facing string changed; everything else is markdown).
- `npm run lint`: pass.
- `npm test --run`: 32 passed | 4 skipped (unchanged from Phase 9).
- Manual smoke: privacy panel renders new copy without layout shift. Dashboard verification: pending user-side per the new SECURITY.md checklist.

## Blockers / surprises

- F8 turned out to be already-resolved by an earlier edit to `vite.config.ts` (the comment block matches the audit recommendation verbatim). Closed without a commit.
- F5's premise was line-stale, not zero-sites stale: `MarkdownPage.tsx` still has the safe site, just at line 39 now (and via JSX spread, so a literal-attribute grep misses it). Net call-site count: one, already correctly paired with `rel="noopener noreferrer"`. Still chose the CLAUDE.md guardrail over the plugin install — linting one already-compliant site doesn't earn the dependency.

## Next phase

Phase 11 candidates (no clear winner — user picks):
- **Quality micro-refactors** — W-2 (`assignSortOrderSlots` redundant slice), W-3 (`withSlugRetry` typeguard + unused counter), W-5 (sort_order out of patch types), W-8 (`category!` non-null assertions), W-9 (docstring hoist), W-10 (placeholder slug helper), W-11 (sorted cache key), W-12 (parseDnDId tighten). Bundle of small commits, low risk.
- **W-6 standalone** — groupByCategory consolidation. Touches the Phase 5 stability layer; deserves its own phase with explicit per-site behavior verification.
- **Medium quality** — M-1 (production observability for failed mutations), M-2 (optimistic `updated_at` bump), M-3 (ListSelector mid-flip), M-5 (CSV reader error/abort), M-7 (RootRedirect re-sort → reduce), M-8 (gearById Map), M-10 (consumable-vs-worn precedence assert).
- **F4 full path** — only if the threat model changes. SECURITY DEFINER `fetch_shared_list(p_slug)` RPC, revoke anon SELECT on `lists`, reshape `list_items_public_select_shared` / `gear_items_public_select_via_shared_list` / `categories_public_select_via_shared_list`. Significant migration + RPC + four-policy reshape; warrants a dedicated phase.
- **Test-coverage cluster** — T-3…T-9; needs jsdom + `@testing-library` install (a one-time tooling change).
```

**Suggested commit:** `docs(review-fix): append Phase 10 summary`

---

## Out of scope for Phase 10

Explicitly NOT in this phase:

- **F4 full path (SECURITY DEFINER + revoke + 4-policy reshape).** The audit itself recommends only doing this "if the threat model changes." The cheap copy tightening lands the user-honesty improvement; the underlying enumeration-by-design remains accepted.
- **F2 (auth tokens in localStorage).** Documented in `SECURITY.md` as accepted-risk for the BaaS architecture. Mitigation requires a backend layer.
- **F3 (account deletion re-auth).** Already shipped in Phase 1 (`d196bf7`).
- **F6 (MarkdownPage safe-config comment).** Already shipped in Phase 1 (`2f356a2`).
- **F7 actual dashboard verification.** This phase only captures the checklist in code. The user must perform the verification on Supabase.com and update the `Last verified` line.
- **eslint-plugin-react install.** Considered for F5 and rejected — zero call sites today, modern browser defaults cover the risk, CLAUDE.md note is right-sized.
- **Cross-cluster bundling.** No quality / test / perf items. Phase 10 stays focused on the security cluster.

If a commit reveals scope expansion (e.g. F4 cheap path turns up an unexpected i18n string-extraction layer; F7 checklist turns up an undocumented dashboard setting), **stop and surface as a blocker** rather than rewriting the spec inline.
