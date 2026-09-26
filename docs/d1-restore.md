# Undoing a bad migration

**Binding, maintained against the code** (AGENTS.md "Documents").

Use this only when a migration that reached production damaged or lost data.
If a deploy failed without such damage, re-run it instead: the `deploy.yml`
header says how.

**How the undo works.** D1 Time Travel is always on and costs nothing. It can
put the database back to any minute in the last **7 days** (Free plan; 30 on
Paid). A restore replaces the whole database in place, including
`d1_migrations`, and every write after that moment is lost. Source:
Cloudflare's "Time Travel and backups" page.

Run these on your own machine after `npx wrangler login`. The sandbox has no
Cloudflare credentials. If any step's answer is unclear, stop and work it out
before touching the database.

1. **Stop deploys.**
   1. Run `gh workflow disable deploy.yml`.
   2. List what is still going: `gh run list --workflow deploy.yml --status in_progress` and `... --status queued`.
   3. Cancel every run listed (`gh run cancel <run-id>`), then list again. Carry on only when both lists are empty.
2. **Find T:** when the damaging migration started.
   - Look at the attempt that actually applied it. After a retry, that is
     not necessarily the latest attempt.
   - `gh run view <run-id> --attempt <n> --json jobs` shows when that
     attempt's "Apply D1 migrations (production)" step started.
3. **Put the right Worker back first,** so the old code is what runs against
   the restored schema.
   1. Run `npx wrangler deployments list` (oldest first; the last entry is live).
   2. The target is the newest deployment created before T.
   3. If the target is already live, do nothing. Otherwise run
      `npx wrangler rollback <target version-id>`, then list the deployments
      again to confirm it is live.
   4. Give the version id explicitly. With no id, wrangler picks the
      previous deployment, which may be the bad one.
4. **Restore the database to just before T:**

   ```
   npx wrangler d1 time-travel restore grampacker --timestamp=<T minus one minute, e.g. 2026-09-26T15:36:00Z>
   ```

   It prints a bookmark that undoes the restore. Keep it.
5. **Take the migration off `main` in a PR, and merge it while deploys are
   still off.**
   - Remove its `.sql`, its journal entry, its snapshot, and any code that
     needs its schema. Otherwise the next deploy applies it again, because
     the restored ledger no longer lists it.
   - `check-migration-immutability.mjs` refuses those removals, so the same
     PR gives it an exception for exactly those paths.
6. **Resume.**
   1. Confirm `npx wrangler d1 migrations list grampacker --remote` shows
      nothing pending.
   2. Run `gh workflow enable deploy.yml`.
   3. Re-run `main`'s latest CI run (`gh run rerun <ci-run-id>`) so the
      deploy fires.
