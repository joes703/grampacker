# Restoring production D1 after a bad migration

**Binding, maintained against the code** (AGENTS.md "Documents"). If a step
here stops matching `deploy.yml` or wrangler, fix this file in the change that
broke it.

Use this when a migration that APPLIED to production damaged or lost data -
whatever the deploy run's final status. A run can fail after its migration
applied ("Deploy Worker" failing, or a later migration in the same run
failing), and re-running it skips what already applied rather than repairing
it. A deploy that failed WITHOUT a harmful migration applying is a re-run, as
the `deploy.yml` header describes.

Nothing here has been rehearsed against production. The commands come from
wrangler's help and source (4.135) and Cloudflare's Time Travel docs.

## What you have

Every production deploy records a D1 Time Travel bookmark immediately before
it migrates, and refuses to migrate if it cannot. The run's job summary ("D1
restore point") holds the bookmark and the exact restore command; the log
holds a notice with the SHA, bookmark and time.

If the run was re-attempted, each attempt recorded its own bookmark: use the
one from the attempt whose "Apply D1 migrations" step applied the bad
migration, not a later attempt's, which was taken after the damage.

If no summary is usable, derive a bookmark from a time just before that
migration step started:

```
npx wrangler d1 time-travel info grampacker --timestamp=2026-09-26T03:45:00Z
```

Time Travel only reaches back a limited window (wrangler accepts up to 30
days; your plan may allow less), so act promptly.

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

1. **Stop deploys, and make sure none is still running.** Disabling the
   workflow only stops NEW runs; a run already queued or in progress keeps
   going, and nothing you do by hand takes its `deploy-production` lock.

   ```
   gh workflow disable deploy.yml
   gh run list --workflow deploy.yml --status in_progress
   gh run list --workflow deploy.yml --status queued
   ```

   Wait for or cancel (`gh run cancel <run-id>`) anything listed, then open
   each interrupted run and note which remote steps completed - a canceled
   run may already have migrated or swapped the Worker.

2. **Establish which Worker is live, and roll it back if needed.** Read it
   from Cloudflare, never from the run's step results: a canceled or failed
   "Deploy Worker" step may still have swapped the Worker before GitHub
   recorded anything.

   ```
   npx wrangler deployments list
   ```

   It prints the ten most recent deployments oldest first, each with its
   `Created` time and the version it serves; the LAST entry is live. The
   TARGET is the newest deployment created before the bad attempt's
   "Apply D1 migrations" step started (the attempt you took the bookmark
   from). If the live deployment IS that target - the bad attempt never
   swapped the Worker - leave it. Otherwise roll back to the target's
   version, and not further:

   ```
   npx wrangler rollback <version-id> --message "restore: <run url>"
   ```

   If you cannot tell which deployment is the target (clock doubt, more than
   ten deployments since, several versions splitting traffic), stop here and
   work it out before touching the database.

   Under the expand/contract rule the target works with both the migrated
   and the restored schema, including after a contract drop, whose reads it
   had already stopped. A migration that broke that rule needs case-specific
   recovery instead.

   Rolling the Worker back before the database matters: restoring first would
   leave the new Worker running against the old schema.

3. **Restore the database** to the bookmark. Note the "previous bookmark" it
   prints.

   ```
   npx wrangler d1 time-travel restore grampacker --bookmark=<bookmark>
   ```

4. **Take the migration off main, completely.** The restored ledger no longer
   lists it, so while its file exists the next deploy applies it again. A
   full reversal is the `.sql` file, its `migrations/meta/_journal.json`
   entry and its snapshot, plus any application code that needs the schema
   the migration created - otherwise the next deploy ships code the restored
   database cannot serve.

   The migration guards refuse this on purpose: `check-migration-immutability.mjs`
   rejects a changed or deleted shipped migration, a deleted snapshot, and a
   non-append journal change, and the harness rejects a journal that names a
   missing file. Neither has an exemption flag. The PR has to change those
   scripts to exempt exactly this migration, in the same change, and that
   exemption gets reviewed like any other change to a guard. CI runs the PR's
   own copy of the scripts, so no ruleset bypass is needed.

5. **Check nothing is pending** before deploys resume:

   ```
   npx wrangler d1 migrations list grampacker --remote
   ```

6. **Resume deploys**, then re-run the CI run for main's head so the deploy
   fires. The liveness watchdog (`deploy-liveness.yml`) may have opened an
   issue while deploys were off; close it once the marker catches up.

   ```
   gh workflow enable deploy.yml
   ```
