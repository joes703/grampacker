# Restoring production D1 after a bad migration

**Binding, maintained against the code** (AGENTS.md "Documents"). If a step
here stops matching `deploy.yml` or wrangler, fix this file in the change that
broke it.

Use this when a deploy SUCCEEDED but its migration damaged or lost data. A
deploy that FAILED is a different problem: re-run it as the `deploy.yml`
header describes. Nothing here has been rehearsed against production; the
commands are from wrangler's own help and source (4.129).

## What you have

Every production deploy records a D1 Time Travel bookmark immediately before
it migrates, and refuses to migrate if it cannot. The bookmark, and the exact
restore command, are in that run's job summary ("D1 restore point") and in its
log as a notice. If the run was re-attempted, every attempt records its own
bookmark: use the one from the attempt whose "Apply D1 migrations" step
actually applied the bad migration, not a later attempt's, which was taken
after the damage. Time Travel only reaches back a limited window (wrangler
accepts up to 30 days; your plan may allow less), so act promptly.

If the summary is missing, derive a bookmark from a time just before the
migration step started:

```
npx wrangler d1 time-travel info grampacker --timestamp=2026-09-26T03:45:00Z
```

## What a restore does

It replaces the WHOLE database with its state at the bookmark. That includes
the `d1_migrations` ledger, so the bad migration becomes pending again, and it
includes users' data: every write made after the bookmark is gone. In-flight
queries are canceled. wrangler prints a "previous bookmark" afterwards, which
undoes the restore if you need to.

## Steps

All of these run on your own machine; the sandbox has no Cloudflare
credentials. Log in first (`npx wrangler login`, through an SSH tunnel on
port 8976 if the browser is elsewhere).

1. **Stop deploys.** `deploy.yml` ships main's head after every green CI run,
   and after a restore that would re-apply the bad migration.

   ```
   gh workflow disable deploy.yml
   ```

2. **Roll the Worker back first**, to the version that was live before the
   bad deploy. Every migration must work with the previous Worker (expand
   first, contract a release later), so the old Worker is safe against both
   the damaged schema and the restored one. Restoring the database first
   would leave the NEW Worker running against the OLD schema.

   ```
   npx wrangler deployments list
   npx wrangler rollback <version-id>
   ```

3. **Restore the database** to the bookmark from the run summary. Note the
   "previous bookmark" it prints.

   ```
   npx wrangler d1 time-travel restore grampacker --bookmark=<bookmark>
   ```

4. **Take the bad migration off main.** Open a PR reverting it. The
   migration-immutability check (`scripts/check-migration-immutability.mjs`)
   refuses any change to a migration main already holds, deletions included,
   so this PR is the one legitimate case for exempting that file in the same
   change - say so in the PR, and get it reviewed like any other change to a
   guard.

5. **Check nothing is pending** before deploys resume. With the revert
   merged, the bad migration's file is gone and its name is absent from the
   restored ledger:

   ```
   npx wrangler d1 migrations list grampacker --remote
   ```

6. **Resume deploys**, then re-run the CI run for main's head so the deploy
   fires. The liveness watchdog (`deploy-liveness.yml`) may have opened an
   issue while deploys were off; close it once the marker catches up.

   ```
   gh workflow enable deploy.yml
   ```
