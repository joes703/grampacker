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
Cloudflare credentials.

1. **Stop deploys:** `gh workflow disable deploy.yml`. Wait for any run still
   in progress, or cancel it with `gh run cancel <run-id>`.
2. **Find T.** T is the time the bad run's "Apply D1 migrations
   (production)" step started. It is on the run page, or in
   `gh run view <run-id> --json jobs`.
3. **Roll the Worker back first,** so the old code is what runs against the
   restored schema. Run `npx wrangler deployments list`; the last entry is
   live. If it was created after T, run `npx wrangler rollback` to go back to
   the previous version.
4. **Restore the database to just before T:**

   ```
   npx wrangler d1 time-travel restore grampacker --timestamp=<T minus one minute, e.g. 2026-09-26T15:36:00Z>
   ```

   It prints a bookmark that undoes the restore. Keep it.
5. **Take the migration off `main` in a PR:** its `.sql`, its journal entry,
   its snapshot, and any code that needs its schema. Otherwise the next
   deploy applies it again, because the restored ledger no longer lists it.
   `check-migration-immutability.mjs` refuses a deleted shipped migration,
   so the same PR adds a narrow exception there for that one file.
6. **Resume:** `gh workflow enable deploy.yml`, then confirm
   `npx wrangler d1 migrations list grampacker --remote` shows only what you
   expect.
