# Grampacker VPS bootstrap and migration runbook

**Status:** Partly executed. Section 1 records what is already done on the VPS.
Everything else has not been run. Sections 10 to 12 are future production
operations and must not run now.

This is the executable companion to `docs/vps-migration-plan.md`. The plan
explains what and why. This runbook gives the exact commands, where each one
runs, what it should print, how to check it, and how to undo it.

## 0. How to use this runbook

### Where a command runs

Every command block starts with a location tag. Run it only there.

| Tag | Meaning |
| --- | --- |
| `[Mac]` | Terminal on the Mac |
| `[walnut]` | Terminal on walnut |
| `[RackNerd console]` | The provider's VNC/serial console in the RackNerd control panel. Works when SSH does not. |
| `[VPS joe]` | SSH session on the VPS as `joe`, ordinary shell |
| `[VPS root]` | Root shell on the VPS, opened from `[VPS joe]` with `sudo -i` |
| `[GitHub web]` | github.com settings pages |
| `[GitHub Actions]` | A workflow run (you start it or watch it; you do not type these commands) |
| `[GHCR]` | GitHub Container Registry, through github.com package pages |
| `[Cloudflare]` | Cloudflare dashboard, or `wrangler` on the Mac where noted |
| `[sandbox]` | The coding agent's sandbox |

`[Mac]` and `[walnut]` are interchangeable for administration. Steps that
need the Cloudflare login (`wrangler`) use the Mac only, because that is where
`wrangler login` already exists (`docs/d1-restore.md`).

### Step labels

| Label | Meaning |
| --- | --- |
| **DONE** | Already completed on 2026-10-11. Listed so it can be re-verified. |
| **NOW** | Safe to run before implementation. Touches no production system. |
| **AFTER IMAGE** | Needs a Grampacker image that the Node/SQLite work has not produced yet. |
| **CONFIRM** | Stop. Changes DNS, a Worker route, D1, production data, or a GitHub security setting. Run only after you have said "yes" to that exact step. |
| **FUTURE PRODUCTION - DO NOT RUN NOW** | Part of the one-time D1 move. Runs only in the approved maintenance window. |

Every step also says whether it is safe to rerun.

### Names used in commands

Set these at the top of a shell before running that section's commands. The
address appears literally only here; commands use `$VPS_HOST`.

```bash
# [Mac] [walnut]
VPS_HOST=104.168.43.9          # current RackNerd address; change only this line after a move
GH_REPO=joes703/grampacker
IMAGE_REPO=ghcr.io/joes703/grampacker
```

```bash
# [VPS joe] [VPS root]
cd /srv/grampacker
```

Placeholders that you replace when you run a command:

| Placeholder | Meaning |
| --- | --- |
| `<APP_DIGEST>` | A Grampacker image digest, `sha256:` plus 64 hex characters, as the Image workflow prints it (step 6.1) |
| `<APP_SHA>` | The full 40-character commit SHA an image was built from; its GHCR tag |
| `<RUN_ID>` | A GitHub Actions run id: `databaseId` in `gh run list --json` |
| `<MERGE_SHA>` | `main`'s head right after a merge, from `git ls-remote` |
| `<DEPLOY_RUN_ID>` | The run id (`databaseId`) of a run of the legacy Deploy workflow (`deploy.yml`) |
| `<BASELINE_TIME>` | The UTC time recorded before the merges in 6.1, such as `2026-10-20T15:30:00Z` |
| `<APP_UID>` | `10001`: the image's fixed non-root UID, which is also its GID (`docs/container-image.md`); step 7.1 verifies it |
| `<ACME_EMAIL>` | The address Let's Encrypt uses for expiry notices |
| `<STAMP>` | A UTC time stamp such as `20261101T1530Z`, one per export |
| `<WORKERS_SUBDOMAIN>` | The account's `workers.dev` subdomain, shown in the Cloudflare dashboard |
| `<IMPORT_COMMAND>` | The D1 import command inside the image, named by its implementation (section 4) |

**Secret values never appear in this file.** Where a secret is needed, the
command reads it from the keyboard with `read -rs` (not saved in shell
history, not shown on screen), or generates it on the VPS so it never travels.

### Stop rules

- If a command's output differs from "Expected", stop. Do not continue to the
  next step until the difference is understood.
- A **CONFIRM** step names exactly what it changes. Approval of one CONFIRM
  step does not approve the next one.
- Never delete the D1 database, a snapshot, or the export archive as part of
  this runbook. Deleting D1 is a separate, later decision.

## 1. Completed VPS base setup (DONE)

These were completed before 2026-10-11. Re-verify them from `[Mac]` before
starting section 3. All checks are read-only and safe to rerun.

| Done | Fact |
| --- | --- |
| DONE | RackNerd KVM, Ubuntu 26.04.1 LTS, kernel `7.0.0-31-generic`, x86-64 |
| DONE | 1.9 GiB RAM, 1 GiB swap, about 32 GB free of about 34 GB |
| DONE | No global IPv6 address (link-local `fe80::` only) |
| DONE | Docker Engine 29.9.0 and Compose 5.6.0 installed; Docker active |
| DONE | User `joe`, key login from the Mac and walnut |
| DONE | Root SSH login off; password and keyboard-interactive login off |
| DONE | UFW: deny incoming, allow outgoing, SSH rate-limited, TCP 80 and 443 allowed |
| DONE | `/srv/grampacker` (`joe:joe 0755`) with `data`, `secrets`, `snapshots` (`joe:joe 0700`) |
| NOT DONE | Caddy, Grampacker, GitHub deployment, GHCR access, DNS changes |

### 1.1 Re-verify the base setup

```bash
# [Mac]
ssh joe@"$VPS_HOST" 'uname -srm; . /etc/os-release; echo "$PRETTY_NAME"; free -h; df -h /'
ssh joe@"$VPS_HOST" 'docker --version; docker compose version; systemctl is-active docker'
ssh joe@"$VPS_HOST" 'ip -6 addr show scope global'
ssh -t joe@"$VPS_HOST" 'sudo sshd -T | grep -E "^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) "'
ssh -t joe@"$VPS_HOST" 'sudo ufw status verbose'
ssh -t joe@"$VPS_HOST" 'sudo ss -tulpn'
ssh joe@"$VPS_HOST" 'stat -c "%U:%G %a %n" /srv/grampacker /srv/grampacker/*'
```

Expected:

- Ubuntu 26.04.1 LTS, `x86_64`, Docker 29.9.0, Compose 5.6.0, `active`.
- `ip -6 addr show scope global` prints nothing.
- `permitrootlogin no`, `passwordauthentication no`,
  `kbdinteractiveauthentication no`.
- UFW `Status: active`, `Default: deny (incoming), allow (outgoing)`, rules for
  `22/tcp LIMIT`, `80/tcp ALLOW`, `443/tcp ALLOW` (and their `(v6)` copies),
  and no UDP 443 rule.
- `ss` shows only SSH on a public address. Local-only listeners such as
  `127.0.0.53` (systemd-resolved) are fine.
- `joe:joe 755 /srv/grampacker`, and `joe:joe 700` for `data`, `secrets`,
  `snapshots`.

If any line differs, stop and fix the base setup first.

### 1.2 Record the SSH host key fingerprint (NOW)

GitHub Actions will pin this key in the deferred deploy job (section 8). Read it from the console,
which does not depend on the network path, and compare it with what the Mac
already trusts.

```bash
# [RackNerd console] logged in as joe
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

```bash
# [Mac]
ssh-keygen -lF "$VPS_HOST"
```

Expected: both print the same `SHA256:...` fingerprint for the ED25519 key.
Write it down in your password manager as "grampacker VPS host key". If they
differ, stop: the Mac may be talking to a different machine.

Rerun: safe.

## 2. Access and credentials

There are four kinds of access. Keep them separate. Never reuse a key from one
row for another.

| # | Credential | Where the secret lives | Logs in as / used by | Allowed to | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Administrator SSH keys | the Mac and walnut | `joe` | everything, through `sudo` | DONE |
| 2 | Temporary provisioning key | the agent sandbox, only while approved | `provision` (temporary account) | what that session needs; removed afterward | not created; not needed now |
| 3 | Deployment SSH key | GitHub: `production` environment secret (Pro) or repository secret (no Pro) | `deploy` | run the deploy wrapper with one image digest; nothing else | deferred (section 8) |
| 4 | Read-only GHCR credential | `/root/.docker/config.json` on the VPS | Docker (as root) | pull Grampacker images; cannot push or delete | step 6 |

### 2.1 Administrator keys (DONE)

`joe` logs in from the Mac and walnut with key authentication. Recovery when
SSH is lost (wrong firewall rule, broken `sshd_config`): the RackNerd console
still works, because it is a virtual screen and keyboard, not SSH.

Check before any change to `sshd` or UFW: keep a second SSH session open, and
test the change from a new session before closing the old one.

```bash
# [Mac] and again from [walnut]
ssh -o PasswordAuthentication=no -o BatchMode=yes joe@"$VPS_HOST" true && echo OK
```

Expected: `OK` from both machines.

### 2.2 Temporary sandbox provisioning key (not now)

The coding sandbox does not need VPS access for the Node/SQLite conversion or
for building the image. **Do not create or install this key now.**

If direct sandbox access is needed later, use only this process.

1. `[sandbox]` Generate a new, dedicated key. It is never reused as your
   personal key or as the deployment key.

   ```bash
   # [sandbox]
   ssh-keygen -t ed25519 -N '' -C "grampacker-provision-$(date -u +%F)" -f ~/.ssh/grampacker_provision
   cat ~/.ssh/grampacker_provision.pub
   ssh-keygen -lf ~/.ssh/grampacker_provision.pub
   ```

   The agent shows you only the `.pub` line and the fingerprint. The private
   key never leaves the sandbox. Outbound SSH from the sandbox to `$VPS_HOST`
   also needs your approval in the sandbox network policy; this runbook does
   not change that policy.

2. `[VPS root]` Create a separate temporary account and install the key.
   Paste the `.pub` line where shown; it is a public key, not a secret.

   ```bash
   # [VPS root]
   adduser --disabled-password --gecos 'temporary provisioning' provision
   install -d -o provision -g provision -m 0700 /home/provision/.ssh
   tee /home/provision/.ssh/authorized_keys >/dev/null <<'EOF'
   restrict,pty PASTE_THE_SANDBOX_PUBLIC_KEY_LINE_HERE
   EOF
   chown provision:provision /home/provision/.ssh/authorized_keys
   chmod 0600 /home/provision/.ssh/authorized_keys
   ssh-keygen -lf /home/provision/.ssh/authorized_keys
   ```

   Expected: the fingerprint matches the one the agent showed you.

   Only if the session truly needs root, grant it for this session alone, and
   know that this is full root:

   ```bash
   # [VPS root]
   tee /etc/sudoers.d/90-provision >/dev/null <<'EOF'
   provision ALL=(ALL) NOPASSWD: ALL
   EOF
   chmod 0440 /etc/sudoers.d/90-provision
   visudo -c
   ```

   Expected: `visudo -c` ends with `parsed OK` for every file.

3. Run the approved provisioning work, watched by you.

4. `[VPS root]` Remove the account and any sudo rule as soon as the work ends.

   ```bash
   # [VPS root]
   pkill -u provision || true
   rm -f /etc/sudoers.d/90-provision
   visudo -c
   deluser --remove-home provision
   getent passwd provision || echo "provision account removed"
   ```

5. Prove removal with a failed connection test.

   ```bash
   # [sandbox]
   ssh -o BatchMode=yes -o IdentitiesOnly=yes -i ~/.ssh/grampacker_provision provision@"$VPS_HOST" true; echo "exit=$?"
   ```

   Expected: `Permission denied (publickey)` and `exit=255`. Any other result
   means the removal is incomplete: stop and repeat step 4.

6. `[sandbox]` Delete the key pair: `rm -f ~/.ssh/grampacker_provision ~/.ssh/grampacker_provision.pub`.

Rerun: step 1 creates a new key each time (do not reuse an old one); steps 4
and 5 are safe to rerun.

### 2.3 Deployment key and GHCR credential

Set up in steps 8 and 6. They are listed in the table above so their limits
are clear before they exist.

## 3. VPS preparation that needs no Grampacker image (NOW)

Nothing here touches production, DNS or Cloudflare.

### 3.1 Check `joe`'s groups and sudo

```bash
# [VPS joe]
id
sudo -v && echo "sudo OK"
```

Expected: `sudo OK`. `joe` does not need to be in the `docker` group: this
runbook runs every Docker command with `sudo`. Rerun: safe.

### 3.2 Pull the Caddy image

Caddy is the official `caddy:latest` image, not pinned. It changes only when
you run `grampacker-deploy caddy-update` (9.4), never during an app deploy.

```bash
# [VPS joe]
sudo docker pull caddy:latest
sudo docker run --rm caddy:latest caddy version
```

Expected: a `v2.x.y` version line. Rerun: safe.

### 3.3 Prove that a Docker port bound to 127.0.0.1 is not public

Docker writes its own packet-filter rules, and they run before UFW's. A port
published as `"8099:80"` would be reachable from the internet even though UFW
has no rule for it. This test proves the `127.0.0.1:` form is not.

```bash
# [VPS joe]
sudo docker run -d --rm --name bindtest -p 127.0.0.1:8099:80 caddy:latest caddy respond --listen :80 "bindtest ok"
curl -sS http://127.0.0.1:8099/
sudo ss -ltnp | grep 8099
```

Expected: `bindtest ok`, and `ss` shows `127.0.0.1:8099` only (no `0.0.0.0`,
no `*`, no `[::]`).

```bash
# [Mac]
nc -vz -w 5 "$VPS_HOST" 8099; echo "exit=$?"
```

Expected: the connection fails (refused or timed out), `exit=1`.

```bash
# [VPS joe]
sudo docker stop bindtest
```

`--rm` removes the container when it stops. Rerun: safe; if `bindtest`
already exists, stop it first.

### 3.4 Create Caddy's directories

```bash
# [VPS joe]
sudo install -d -o root -g root -m 0700 /srv/grampacker/caddy /srv/grampacker/caddy/data /srv/grampacker/caddy/config
sudo stat -c '%U:%G %a %n' /srv/grampacker/caddy /srv/grampacker/caddy/data /srv/grampacker/caddy/config
```

Expected: `root:root 700` for all three. The official Caddy image runs as
root; these hold the certificates and the ACME account key. Rerun: safe.

### 3.5 Install `sqlite3`, and `jq` (optional)

`sqlite3` checks a rollback copy's integrity (12.2):
`sudo apt-get install -y sqlite3`. The checks in this runbook avoid `jq` on
the VPS; install it only for your own inspection:
`sudo apt-get install -y jq`. Rerun: safe.

## 4. Implementation deliverables this runbook depends on (sandbox)

`[sandbox]` work, reviewed and merged through the normal PR process. The
sandbox needs no VPS, Cloudflare or production access for any of it. Each item
is a contract; the exact file names are chosen during implementation and then
written back into this runbook in the same PR.

| Item | Contract the runbook relies on |
| --- | --- |
| Dockerfile | Multi-stage, glibc Node base, non-root numeric UID, `EXPOSE 3000`, no secrets, no database, no `.dev.vars` copy. |
| Image health check | Passes only on HTTP 200 **and** a JSON body whose `ok` is exactly `true`, within a timeout (3 seconds is a reasonable start). Any other status, a non-JSON body, `{"ok":false}`, or a timeout is unhealthy. |
| Migrate command | Runs inside the image, applies pending Drizzle migrations to `/data/grampacker.db`, prints what it applied, exits non-zero on any failure. Safe to rerun: applied migrations are skipped. |
| D1 import command | Runs inside the image with `--network none`. Implements the plan's "Import" steps 1 to 15, writes a new database file (never overwrites an existing one), and prints a report: schema comparison, `integrity_check`, `foreign_key_check`, invariant checks, rows in the export against rows loaded per table (must always match), per-table counts against the D1 counts (must match, except with `--rehearsal`, where a difference is reported for the operator to review but does not fail the run), deleted transient rows, passkey field comparison. Before reporting success it checkpoints, closes every connection, and leaves a self-contained file: no `-wal` or `-shm` file beside it. Exits non-zero if any check fails. |
| Client address | The application reads the last `X-Forwarded-For` entry, which Caddy writes, and no longer reads `cf-connecting-ip`. |
| Configuration | A documented list of environment variables. Known today: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. The database path and port are expected to have fixed defaults (`/data/grampacker.db`, `3000`). |
| Deployment files | **Built:** `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/Caddyfile.rehearsal`, `deploy/grampacker-deploy` (section 7). The script runs as root: `deploy <APP_DIGEST>` (accepts only `^sha256:[0-9a-f]{64}$`), `rollback <dir>`, `maintenance on\|off`, `caddy-update`. A rollback point is `rollback/<UTC time>/` with the stopped `data/` directory and `previous-image`. |
| SSH wrapper | **Deferred** with the deploy job (section 8). |
| Maintenance response | **Built:** the file `maintenance/on`, checked by Caddy on every request. 503 for every path including `/api/*`; works with the app stopped; survives a Caddy restart; `grampacker-deploy maintenance on\|off`; provable with one `curl`. |
| CI | **Built:** `image.yml` builds the image and runs `scripts/check-image.sh` on pull requests (no push), beside `ci.yml`'s checks. |
| Publish workflow | **Built:** `image.yml`, step 6.1. `workflow_dispatch`, no inputs; every job carries `github.ref == 'refs/heads/main'`, so a dispatch from any other branch runs nothing; checks out the dispatched commit; runs build, unit, API and migration checks; builds `linux/amd64` with the label `org.opencontainers.image.source=https://github.com/joes703/grampacker`; runs `scripts/check-image.sh`; pushes `$IMAGE_REPO:<full SHA>` unless that tag exists; prints the digest. One concurrency group, never canceled in progress. Never deploys. |
| Deploy job | **Deferred** (section 8). Takes a digest the publish workflow printed, and (in the `production` environment when Pro is available) runs SSH with a pinned host key and sends only that digest. Whether it is a job in `image.yml` or its own workflow is decided with section 8. |

Section 7 needs only what is built. Sections 10 and 11 also need the D1
import command, which is not built.

## 5. GitHub settings for the deferred deploy job (GitHub web)

### 5.1 Check whether the account has GitHub Pro (NOW)

Automated deployment works either way. Pro decides only where the deployment
key is stored and what enforces "deploy `main` only".

| | With Pro | Without Pro |
| --- | --- | --- |
| Key stored as | secret of the `production` environment (5.2) | repository secret |
| "main only" enforced by | GitHub: the environment's branch rule refuses the secret to any other branch | the workflow: every job has `if: github.ref == 'refs/heads/main'` |
| A branch that edits the workflow and dispatches it | is refused the secret | would receive the secret |

The last row is why today's `deploy.yml` forbids `workflow_dispatch`. Without
Pro, it is still acceptable here because no one but Joe can both change a
workflow file and dispatch it: the agent tokens have no Workflows permission
and only read access to Actions (`docs/testing-and-ci.md` section 12). Before
storing the key as a repository secret, confirm those two token settings on
GitHub's token settings page. If either has changed, stop and decide again.
In both cases the VPS's forced command (step 8) limits the key to deploying
an image digest.

`[GitHub web]` Check: your account Settings, Billing and licensing (Plans).

- **Pro:** do 5.2 when the deploy job (section 8) is built.
- **No Pro:** skip 5.2; the deploy job will use a repository secret.

### 5.2 Create the `production` environment (CONFIRM, needs Pro)

`[GitHub web]` Repository Settings, Environments, New environment:

1. Name: `production`.
2. Deployment branches and tags: **Selected branches and tags**, add the rule
   `main` only.
3. Required reviewers: optional. Adding yourself means each deploy waits for
   one more click; useful, not required.
4. Leave secrets empty; the deploy job (section 8) adds them.

Verify: the environment page shows "1 branch rule: main".

Undo: delete the environment (its secrets go with it).

Rerun: safe; editing an existing environment has the same result.

## 6. GHCR access

### 6.1 Publishing (GitHub Actions, AFTER IMAGE)

`.github/workflows/image.yml` ("Image") publishes; it never deploys. On a
pull request it builds the image and runs `scripts/check-image.sh`, and
pushes nothing. Started by hand on `main`, it:

1. runs `npm run build`, `npm test` and `npm run test:migrations` on the
   dispatched commit (job "Pre-publish checks");
2. builds `linux/amd64`, runs `scripts/check-image.sh`, then pushes
   `$IMAGE_REPO:<full commit SHA>` with the run's own short-lived
   `GITHUB_TOKEN` (`packages: write`); no personal token is involved (job
   "Publish image to GHCR");
3. reads the image back from GHCR by digest, checks that it is one
   linux/amd64 image and the one that was tested, and prints the digest in
   the log and the run summary.

The tag is never replaced. If `<full commit SHA>` is already in GHCR, the run
fails and names the digest that tag points to. That check runs just before
the push and is not atomic; it guards against a rerun, not against another
writer pushing at the same moment. A deployment always uses the
digest, never the tag.

A dispatch from any other branch runs no job. The workflow has no inputs.

Prerequisite: `image.yml` is on `main`. GitHub offers "Run workflow" only
for workflow files on the default branch. It reaches `main` with the
Node/SQLite branch, so the merge order below comes first.

#### Merge order: stop Worker deploys, then merge the migration branch

Until this order runs, a merge to `main` deploys `main` to the Worker
(`deploy.yml`) and applies its migrations to D1. The Worker cannot run the
Node/SQLite code. The deployment-safety change (branch
`ci/stop-worker-auto-deploy`) makes `deploy.yml` legacy: every job is
`if: false`, and `deploy-liveness.yml` loses its schedule. After it merges,
each CI run on `main` still starts a Deploy run, but both of its jobs are
skipped. The Worker keeps serving the last commit it deployed, and rollback
(11.9) uses that running Worker. Rollback never runs `deploy.yml`, and **no
one ever re-runs an earlier Deploy run**: a re-run uses that run's old copy of
the workflow, which still deploys, and can deploy `main` as it is now (header
of `deploy.yml`).

Before you start, make sure no Deploy run is still going, then record the
baseline. `deploy.yml` deploys the Worker before it writes its GitHub
deployment record, so the GitHub record alone cannot prove that nothing
deployed. Cloudflare's own list of Worker deployments is the proof; the
GitHub checks support it.

```bash
# [Mac] in a checkout of main, where `wrangler login` already exists
gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?status=in_progress" --jq .total_count
gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?status=queued" --jq .total_count
date -u +%Y-%m-%dT%H:%M:%SZ
gh api "repos/$GH_REPO/deployments?environment=production&per_page=1" \
  --jq '.[0] | [.sha, .created_at] | @tsv'
npx wrangler deployments list --name grampacker
```

The Deploy runs are read through the REST API, which works for any `gh`
version and also after the workflow is disabled. Both counts must be `0`; if
one is not, wait for the run to finish and count again. Never cancel or
re-run a Deploy run to clear it. The `date` line
is `<BASELINE_TIME>`. Record the GitHub record's SHA and time, and the
version id and time of the last (newest) Cloudflare deployment. `wrangler
deployments list` only reads; it changes nothing. Steps 3 and 4 expect all of
these unchanged.

1. **Push the migration branch.** From the Mac, because the branch changes
   workflow files and the agent tokens cannot push those
   (`docs/testing-and-ci.md` section 12):

   ```bash
   # [Mac]
   git push -u origin feat/node-sqlite-foundation
   ```

   Opening its pull request is safe: pull request CI never deploys. Do not
   merge it yet.

2. **Merge the deployment-safety change first.** Its pull request merges
   through the normal process (`AGENTS.md` "Shipping"). The merge itself
   cannot deploy: the Deploy run that main's CI starts uses the merged copy,
   whose jobs are `if: false`. Even if it did deploy, it would deploy Worker
   code: the migration is not on `main` yet. That is why this change goes
   first.

3. **Confirm that no Cloudflare deployment ran.** Wait for `main`'s CI run
   for the merge to finish; the Deploy run starts when it does.

   ```bash
   # [Mac]
   git ls-remote https://github.com/$GH_REPO refs/heads/main
   gh run list --repo "$GH_REPO" --workflow ci.yml --branch main --event push --limit 1 \
     --json databaseId,headSha,status,conclusion
   gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?per_page=100" \
     --jq '.workflow_runs[] | select(.updated_at >= "<BASELINE_TIME>")
       | [.id, .run_attempt, .event, .status, .conclusion, .created_at, .html_url] | @tsv'
   gh api "repos/$GH_REPO/actions/runs/<DEPLOY_RUN_ID>/jobs" \
     --jq '.jobs[] | [.name, .status, .conclusion] | @tsv'
   gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?status=in_progress" --jq .total_count
   gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?status=queued" --jq .total_count
   gh api "repos/$GH_REPO/deployments?environment=production&per_page=1" \
     --jq '.[0] | [.sha, .created_at] | @tsv'
   npx wrangler deployments list --name grampacker
   ```

   Expected:
   - `ls-remote` prints `<MERGE_SHA>`.
   - The CI run has `headSha` `<MERGE_SHA>` and status `completed`.
   - The filtered Deploy list (one line per run: id, attempt, event, status,
     conclusion, created, URL) shows only runs **created** after
     `<BASELINE_TIME>`, each with attempt `1`. In step 3 it must include at
     least one run created after main's CI run for `<MERGE_SHA>` finished; if
     there is none yet, wait a minute and query again. A re-run of an older run does
     not create a new run: it adds an attempt to the old one, so an older
     creation time or an attempt above 1 here means someone re-ran a Deploy
     run. Stop and find out what it did. The list covers the newest 100
     Deploy runs; an older run re-run now would fall outside it, which the
     Cloudflare check below still catches.
   - Run the jobs query for each listed run (its id is `<DEPLOY_RUN_ID>`).
     Each lists "Verify this SHA is deployable" and "Deploy to Cloudflare",
     both `completed` and `skipped`. No step ran, so no secret was read.
     Read the jobs, not the run: GitHub may report a run whose jobs were all
     skipped as `skipped` or as `success`.
   - Both counts are `0`.
   - The GitHub deployment record is unchanged from the baseline.
   - **The newest Cloudflare deployment is the same version id and time as
     the baseline.** This is the check that proves no Worker deployment ran.
   - Optional, read-only:
     `curl -sS https://grampacker.app/api/health` still prints `{"ok":true}`.

   In the Actions tab, no "Deploy to Cloudflare" job since the baseline has
   a log. If any job ran, either record changed, or a listed run is older
   than the baseline, stop: do not merge the migration branch.

   Recommended (CONFIRM): also disable both legacy workflows in GitHub, so
   they are not even started. Disable them only after the check above,
   because a disabled workflow starts no run to inspect. This was step 4 of
   11.0, and it moves here because `main` now receives Node/SQLite code
   weeks before the cutover:

   ```bash
   # [Mac]
   gh workflow disable deploy.yml --repo "$GH_REPO"
   gh workflow disable deploy-liveness.yml --repo "$GH_REPO"
   gh workflow list --all --repo "$GH_REPO"
   ```

   Expected: both show `disabled_manually`. Undo: `gh workflow enable` for
   each. Enabling deploys nothing, because the jobs stay `if: false`. Whether
   GitHub also refuses a re-run of an old run of a disabled workflow is not
   verified here. The "never re-run a Deploy run" rule stands either way.

4. **Merge the migration branch.** If its pull request is behind `main`,
   merge `main` into it (never rebase or force-push), then let CI pass and
   merge through the normal process. Then repeat step 3 with the new
   `<MERGE_SHA>`. The filtered list still shows the runs you checked in
   step 3; they must be unchanged (same attempt, still skipped). If the
   legacy workflows are disabled, no run may be added to it; otherwise each
   added run is checked as in step 3. In both cases the GitHub
   record and the newest Cloudflare deployment must still match the baseline,
   and the Worker must still answer `{"ok":true}`.

5. **Run the GHCR publishing workflow by hand from `main`:** "First
   publish (rehearsal)" below.

Record each merge SHA and the Deploy run URL in section 13.

#### First publish (rehearsal)

Nothing on the VPS is needed: this run only publishes.

```bash
# [Mac] [walnut]
git ls-remote https://github.com/$GH_REPO refs/heads/main
gh workflow run image.yml --repo "$GH_REPO" --ref main
gh run list --repo "$GH_REPO" --workflow image.yml --event workflow_dispatch --limit 1 \
  --json databaseId,headSha,status,url
```

The first command prints main's head: that is `<APP_SHA>`. Wait a few
seconds before `gh run list`; the run takes a moment to appear. Its
`headSha` must equal `<APP_SHA>`, and its `databaseId` is `<RUN_ID>`.

```bash
# [Mac] [walnut]
gh run watch <RUN_ID> --repo "$GH_REPO" --exit-status
gh run view <RUN_ID> --repo "$GH_REPO" --log | grep -E 'published |digest +sha256:|image +ghcr'
```

Expected: "Pre-publish checks" and "Publish image to GHCR" succeed, and the last command
prints:

```text
published ghcr.io/joes703/grampacker:<APP_SHA>
digest    sha256:<64 hex>
image     ghcr.io/joes703/grampacker@sha256:<64 hex>
```

That `sha256:...` is `<APP_DIGEST>`. The run's summary page shows the same
values. Record both in section 13.

#### Package visibility and access

The package is created by the first push. `[GHCR]` Your profile, Packages,
`grampacker`:

1. It is **Private**. Do not make it Public: GitHub documents that a public
   package cannot be made private again (recheck GitHub's "Configuring a
   package's access control and visibility" before acting). If it shows
   Public, stop and deploy nothing until it is decided.
2. It is linked to `joes703/grampacker` (the image's
   `org.opencontainers.image.source` label asks for that link).
3. Package settings, "Manage Actions access": the `grampacker` repository has
   **Write**. No other repository is listed.

The VPS pulls with its own read-only token (6.2), never with this one.

#### Verify the published image

From the VPS, once 6.3 has logged Docker in:

```bash
# [VPS root]
docker pull "ghcr.io/joes703/grampacker:<APP_SHA>"
docker pull "ghcr.io/joes703/grampacker@<APP_DIGEST>"
docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: the first pull prints `Digest: <APP_DIGEST>`; the second downloads
nothing new; the inspect prints `linux/amd64 <APP_SHA>`. Docker checks the
downloaded content against the digest, so a digest pull cannot return
another image. Step 7.1 then checks the runtime user.

#### When a run fails

| Where | What it means | What to do |
| --- | --- | --- |
| "Pre-publish checks", the image build or `check-image.sh` | Nothing was pushed | Fix it through a pull request, then dispatch again from `main` |
| "already exists" | That commit is already in GHCR | Use the digest only if an earlier run for this commit **succeeded** and printed it. Otherwise treat it as the next row |
| After the push (read-back check) | The tag exists but its image was not verified | Deploy nothing from this commit. `[GHCR]` delete that package version, then rerun |
| "could not check whether ... exists" | GHCR answered the tag lookup with something other than a plain "not found", so nothing was pushed | Read the error it prints. Tested only against a local registry: if the **first** publish stops here because the package does not exist yet, report the exact error and change nothing by hand |
| Login or push | Usually GHCR access (step above) | Check the package's Actions access, then rerun |

Rerun: `gh run rerun <RUN_ID> --repo "$GH_REPO" --failed`. A rerun keeps
the original commit and workflow file. After a successful publish a rerun
stops at "already exists" and changes nothing.

Undo: `[GHCR]` delete the package version (or the whole package). Nothing
outside GHCR changed.

### 6.2 Create the VPS's read-only token (AFTER IMAGE)

`[GitHub web]` Settings, Developer settings, Personal access tokens, Tokens
(classic), Generate new token (classic):

- Note: `grampacker VPS GHCR pull`
- Expiration: one year. Add a calendar reminder two weeks before.
- Scopes: **`read:packages` only.** Nothing else.

A classic token is used because GHCR does not accept fine-grained tokens for
pulls at the time of writing; recheck that when you create it. `read:packages`
cannot push or delete images.

Copy the token once. It goes straight to the next step.

### 6.3 Log Docker in to GHCR on the VPS (AFTER IMAGE)

The deploy script runs as root, so the credential lives in root's Docker
configuration, which `deploy` cannot read.

```bash
# [VPS root]
read -rsp 'GHCR read-only token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u joes703 --password-stdin
unset GHCR_TOKEN
stat -c '%U:%G %a %n' /root/.docker/config.json
```

Expected: `Login Succeeded`, and `root:root 600 /root/.docker/config.json`.
Docker warns that the credential is stored unencrypted; that is expected here.

Verify:

```bash
# [VPS root]
docker pull "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: the image downloads, or "Image is up to date".

Rerun: safe; a new login replaces the stored credential.

Rotate or revoke: `[GitHub web]` delete the token, then repeat 6.2 and 6.3.
`[VPS root]` `docker logout ghcr.io` removes it from the VPS.

## 7. Deployment files and the empty-database rehearsal (AFTER IMAGE)

The deployment is two containers (the app and Caddy), one SQLite data
directory, and one script. All three files come from `deploy/` in the
repository:

| Repository file | Installed as | What it is |
| --- | --- | --- |
| `deploy/compose.yaml` | `/srv/grampacker/compose.yaml` | The app (exact image digest, `127.0.0.1` only, UID/GID 10001, read-only root filesystem, `/tmp` tmpfs) and Caddy (`caddy:latest`, host networking) |
| `deploy/Caddyfile` | `/srv/grampacker/Caddyfile` | `grampacker.app`: HTTPS, maintenance switch, proxy to the app |
| `deploy/Caddyfile.rehearsal` | `/srv/grampacker-rehearsal/Caddyfile.rehearsal` | The same, on `http://127.0.0.1:8081` only, for the rehearsal |
| `deploy/grampacker-deploy` | `/usr/local/sbin/grampacker-deploy` | `deploy`, `rollback`, `maintenance`, `caddy-update` |

**Maintenance** is on while the file `maintenance/on` exists. Caddy then
answers 503 to every path, including `/api/*`, whether or not the app runs,
and it stays on after a Caddy restart. `grampacker-deploy maintenance on|off`
switches it and proves the result through Caddy.

**Caddy is not pinned.** It changes only through `grampacker-deploy
caddy-update`, which pulls `caddy:latest`, validates the Caddyfile with the
new image, recreates only Caddy and checks it answers. An app deploy never
pulls or restarts Caddy.

**Before changing any file in `deploy/`**, rehearse it (7.4) in the sandbox
or on the VPS. The rehearsal is the required check for deployment changes;
CI does not run it.

### 7.1 Check the image's runtime UID and hand it the data directory

```bash
# [VPS root]
docker run --rm --entrypoint id "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: exactly `uid=10001(app) gid=10001(app) groups=10001(app)`. If it
prints anything else, stop: the image does not match this runbook.

```bash
# [VPS root]
cd /srv/grampacker
chown 10001:10001 data
chmod 0700 data
install -d -m 0755 maintenance
install -d -m 0700 rollback
stat -c '%u:%g %a %n' data maintenance rollback caddy/data caddy/config
```

Expected: `10001:10001 700 data`, `0:0 755 maintenance`, `0:0 700` for
`rollback`, `caddy/data` and `caddy/config`. `joe` needs `sudo` to read
`data`, which is intended. Rerun: safe.

`snapshots/` from the base setup is no longer used. Leave it empty.

### 7.2 Install the files from a merged `main` commit

```bash
# [Mac] in a clean checkout of main
git -C ~/code/grampacker fetch origin
git -C ~/code/grampacker switch --detach origin/main
git -C ~/code/grampacker status --short
cd ~/code/grampacker/deploy
shasum -a 256 compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy
scp compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy joe@"$VPS_HOST":/tmp/
```

```bash
# [VPS root]
cd /tmp
sha256sum compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy
install -o root -g root -m 0755 grampacker-deploy /usr/local/sbin/grampacker-deploy
install -o root -g root -m 0644 compose.yaml Caddyfile /srv/grampacker/
```

Expected: the two hash lists match exactly; `status --short` printed
nothing. Keep `/tmp/compose.yaml` and `/tmp/Caddyfile.rehearsal` for 7.4.
Rerun: safe. Repeat this step whenever a file in `deploy/` changes on
`main`.

### 7.3 Write `deploy.env`

No secrets. It records which app image runs; only `grampacker-deploy`
changes `APP_IMAGE` after this.

```bash
# [VPS root]
tee /srv/grampacker/deploy.env >/dev/null <<'EOF'
APP_IMAGE=ghcr.io/joes703/grampacker@<APP_DIGEST>
ACME_EMAIL=<ACME_EMAIL>
SITE_URL=https://grampacker.app/
EOF
chmod 0644 /srv/grampacker/deploy.env
cat /srv/grampacker/deploy.env
```

Replace the two placeholders first. Expected: no `<...>` remains. The
production secrets (`secrets/app.env`) are written at cutover, in 11.5.
Production does not start before then.

### 7.4 Empty-database rehearsal (NOW, no DNS, no production data)

Runs the real script against a separate directory,
`/srv/grampacker-rehearsal` (Compose project `grampacker-rehearsal`), with
the app on `127.0.0.1:3001` and a local-only Caddy on `127.0.0.1:8081`.
It requests no certificate, binds nothing on ports 80 or 443, and does not
touch `/srv/grampacker`, DNS, Cloudflare or production data. Run 7.2 first.

Set up:

```bash
# [VPS root]
R=/srv/grampacker-rehearsal
install -d -m 0755 "$R" "$R/maintenance"
install -d -m 0700 "$R/data" "$R/secrets" "$R/rollback" "$R/caddy" "$R/caddy/data" "$R/caddy/config"
chown 10001:10001 "$R/data"
install -m 0644 /tmp/compose.yaml /tmp/Caddyfile.rehearsal "$R/"
tee "$R/deploy.env" >/dev/null <<'EOF'
APP_IMAGE=ghcr.io/joes703/grampacker@<APP_DIGEST>
APP_PORT=3001
CADDYFILE=Caddyfile.rehearsal
SITE_URL=http://127.0.0.1:8081/
EOF
( umask 077
  printf 'BETTER_AUTH_URL=https://grampacker.app\nBETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" > "$R/secrets/app.env" )
touch "$R/maintenance/on"
export GRAMPACKER_ROOT="$R"
```

The secret is a throwaway, generated here. With no `RESEND_API_KEY`,
magic-link email fails closed, which the rehearsal does not need.

Start Caddy closed, then deploy onto the empty database:

```bash
# [VPS root] same shell (GRAMPACKER_ROOT is set)
grampacker-deploy caddy-update
grampacker-deploy deploy <APP_DIGEST>
curl -sS -w ' %{http_code}\n' http://127.0.0.1:8081/api/health
```

Expected: `caddy-update` ends with `Caddy updated: sha256:..., answering
503`. `deploy` prints `maintenance is on`, `data copied to
/srv/grampacker-rehearsal/rollback/<stamp>`, `applied N migration(s)`, `app
is healthy`, `maintenance is off`, `deployed ...`. The `curl` prints
`{"ok":true} 200`.

Restart, and maintenance:

```bash
# [VPS root] same shell
cd "$R"
docker compose --env-file deploy.env restart app caddy
sleep 30
curl -sS -w ' %{http_code}\n' http://127.0.0.1:8081/api/health
grampacker-deploy maintenance on
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/api/categories
docker compose --env-file deploy.env restart caddy
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/
docker compose --env-file deploy.env stop app
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/lists/x
docker compose --env-file deploy.env start app
sleep 30
grampacker-deploy maintenance off
```

Expected: `{"ok":true} 200`, `maintenance is on`, then `503` three times
(an API path, after a Caddy restart, with the app stopped), then
`maintenance is off`.

Rollback. The first deploy had no previous image, so deploy once more,
then roll back to the point that deploy made:

```bash
# [VPS root] same shell
grampacker-deploy deploy <APP_DIGEST>
ls "$R/rollback"
cat "$R/rollback/<newest stamp>/previous-image"
grampacker-deploy rollback "$R/rollback/<newest stamp>"
grampacker-deploy maintenance on
grampacker-deploy rollback "$R/rollback/<newest stamp>"
grampacker-deploy maintenance off
```

Expected: `previous-image` holds `ghcr.io/joes703/grampacker@<APP_DIGEST>`.
The first `rollback` refuses with `turn maintenance on first`. The second
prints `current data moved to .../failed-data-<time>`, `app is healthy`,
`rolled back to ...` and `maintenance is still on`. Then `maintenance is
off`.

Tear down:

```bash
# [VPS root]
cd /srv/grampacker-rehearsal && docker compose --env-file deploy.env down
unset GRAMPACKER_ROOT
rm -rf /srv/grampacker-rehearsal
```

Rerun: safe after the tear-down. Record the time it took in section 13.

## 8. GitHub-to-VPS deployment (DEFERRED)

Deploying from GitHub Actions (a `deploy` account, an SSH key limited by a
forced command, the key in GitHub) is a later slice. Until then every
deployment is the manual command in 9.1. That slice will call
`grampacker-deploy deploy <APP_DIGEST>` and nothing else.

## 9. Routine deployments (AFTER CUTOVER)

### 9.1 Deploy

The digest is one the Image workflow printed for a run on `main` (6.1).

```bash
# [Mac]
ssh -t joe@"$VPS_HOST" 'sudo /usr/local/sbin/grampacker-deploy deploy <APP_DIGEST>'
```

`-t` lets `sudo` ask for `joe`'s password. The script refuses anything but a
bare `sha256:` digest. In order, it:

1. takes a lock (`/srv/grampacker/.deploy.lock`), so two commands never
   overlap;
2. pulls the image, unless that exact digest is already on the VPS;
3. turns maintenance on and proves the 503 through Caddy; if it cannot, it
   stops before anything else changes;
4. stops the app, so nothing writes to SQLite;
5. copies the whole `data/` directory (database, WAL and SHM files) to
   `rollback/<UTC time>/data`, and writes the image that was running to
   `rollback/<UTC time>/previous-image`;
6. runs `migrate` with the new image;
7. writes the new digest into `deploy.env`, starts the app, waits for
   Docker's health check, then checks `/api/health` (200 and exactly
   `{"ok":true}`) and the homepage (200, HTML);
8. turns maintenance off and proves a 200 through Caddy.

Verify:

```bash
# [Mac]
curl -sS -w ' %{http_code}\n' https://grampacker.app/api/health
```

Expected: `{"ok":true} 200`. Rerun: safe; the same digest redeploys and
makes a new rollback directory.

### 9.2 When a deploy fails

The script prints `DEPLOY FAILED`, whether maintenance is still on, and the
rollback directory (or that none was made, in which case `data/` was not
changed). No public write has happened since the copy, so restoring it is
safe:

```bash
# [VPS root]
grampacker-deploy rollback /srv/grampacker/rollback/<stamp>
```

It stops the app, moves the failed `data/` to
`rollback/<stamp>/failed-data-<time>` (kept), restores the saved directory,
starts the image named in `previous-image`, and checks health. Maintenance
stays on. Look at the site through Caddy, then:

```bash
# [VPS root]
grampacker-deploy maintenance off
```

If no rollback directory was made (the failure came before the copy), the
data is untouched: start the image that was running and reopen.

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env up -d --no-deps app
grampacker-deploy maintenance off
```

The script refuses to roll back the first deploy (its `previous-image` is
empty). If the message said the maintenance file was already removed, the
site may have reopened: 9.3 applies.

### 9.3 Rolling back after traffic has reopened

**Manual judgment, every time.** A rollback directory holds the data from
before the deploy, so restoring it after the public has written to the new
database deletes those writes from the live database (they stay in
`failed-data-<time>`). Before doing it, decide in writing: what is broken,
what writes would be lost (the time since reopening), and whether a
fix-forward is possible instead. If the answer is still "restore":

```bash
# [VPS root]
grampacker-deploy maintenance on
grampacker-deploy rollback /srv/grampacker/rollback/<stamp>
```

`rollback` refuses unless maintenance is on, so that step cannot be skipped
by accident.

### 9.4 Update Caddy

```bash
# [VPS root]
grampacker-deploy caddy-update
```

It pulls `caddy:latest`, validates `/srv/grampacker/Caddyfile` with that
image, recreates only Caddy, and waits up to a minute for the site to answer
200 (or 503 while maintenance is on). If validation fails, the running Caddy
is not touched.

### 9.5 Disk space and image cleanup

Each deploy leaves one rollback directory, about the size of the database.
Nothing deletes them. Kopia is the long-term backup; a rollback directory
is only the immediate way back from one deploy. When a deploy has run well
for a while, delete older rollback directories by hand, keeping the newest
few:

```bash
# [VPS root]
ls -l /srv/grampacker/rollback
du -sh /srv/grampacker/rollback/*
rm -rf /srv/grampacker/rollback/<old stamp>
```

```bash
# [VPS root]
docker image ls
docker image prune -f
```

`prune -f` removes images no container uses, which can include the previous
app image. A later rollback then pulls it from GHCR again by digest, which
needs GHCR to answer. Prune only when the current deploy is known good.
Never use `prune -a` here.

## 10. Staging with a copy of production (CONFIRM, production data)

**Not ready.** Staging needs a DNS record and a Caddy site of its own, and
neither is built: the deployment files in section 7 hold only production and
the local rehearsal. Staging is designed together with the D1 import
command, and the commands below are revised then. Do not run them as they
are.

Needed so an existing passkey can be tested on staging before cutover. This
reads production data and puts a copy on the VPS. The copy is protected like
production and deleted when staging is retired.

### 10.1 Rehearsal export

Same commands as 11.2 and 11.3, but **without** the freeze in 11.1:
production stays live. Use a separate `<STAMP>` and folder, and mark it
`rehearsal`.

Because production keeps accepting writes, the D1 row counts taken a moment
after the export may differ slightly from the export. In a rehearsal, the
import report's "rows in the export against rows loaded" check must match
exactly; a difference against the D1 counts is acceptable only if it is small
and explained by live use. That is what the importer's `--rehearsal` option
allows (10.2). At cutover (11.4), writes are frozen, `--rehearsal` is not
used, and every count must match.

### 10.2 Import into staging

Same command as 11.4, with `--rehearsal` added, and nothing from 11.5 (which
switches to production configuration). Review any D1-count difference the
report lists, as described in 10.1. Then set the staging app to use the result:

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env stop app
DEST=snapshots/staging-empty-<STAMP>
install -d -o <APP_UID> -g <APP_UID> -m 0700 "$DEST"
mv data/grampacker.db "$DEST"/ && echo "database moved"
for x in -wal -shm; do [ ! -e "data/grampacker.db$x" ] || mv "data/grampacker.db$x" "$DEST"/ || echo "FAILED to move grampacker.db$x"; done
ls -la data/
ls -la data/grampacker.db.import*
```

Expected: `database moved`, no `FAILED` line, no `grampacker.db`,
`grampacker.db-wal` or `grampacker.db-shm` left in `data/`, and exactly one
file `grampacker.db.import` (no `.import-wal` or `.import-shm`). If anything
differs, stop. Then promote it:

```bash
# [VPS root]
cd /srv/grampacker
mv data/grampacker.db.import data/grampacker.db
docker compose --env-file deploy.env up -d app
```

### 10.3 Test an existing passkey and a magic link on staging

In a browser on a device that already has a `grampacker.app` passkey:

1. Open `https://staging.grampacker.app/` and sign in with the passkey.
   Expected: sign-in succeeds. The browser offers the existing credential
   because the RP ID is still `grampacker.app`.
2. Sign out. Request a magic link for the same account. Expected: the email
   arrives and its link starts with `https://staging.grampacker.app/`; it
   signs in.
3. Open two representative lists and one public share link (replace the host
   with `staging.grampacker.app`). Expected: the same contents as production.
4. Check the application log for errors from those requests:

   ```bash
   # [VPS root]
   docker compose --env-file /srv/grampacker/deploy.env logs --tail 100 app
   ```

   Expected: no errors from the sign-in requests.

If the passkey fails but the magic link works: stop. Do not continue to
section 11. Compare the imported passkey row with D1 (the import report's
passkey section) before anything else.

Record how long 10.1 and 10.2 took. The plan requires **two** rehearsals that
pass every check before cutover.

## 11. One-time D1 to SQLite move (FUTURE PRODUCTION - DO NOT RUN NOW)

Every step in this section is a production operation. It runs once, in an
announced maintenance window, after: section 4 is merged, sections 5 to 9 are
done, and two rehearsals (section 10) passed. Each CONFIRM step needs its own
"yes".

Expected downtime: the length of the rehearsal timings, plus DNS cache and
certificate time (minutes, not seconds).

### 11.0 Before the window

1. `[Mac]` Re-read `wrangler.jsonc` and record the Worker's current routes and
   custom domains, and whether `workers.dev` and preview URLs are on
   (`[Cloudflare]` Workers & Pages, `grampacker`, Settings, Domains & Routes).
2. `[Cloudflare]` Record every DNS record for `grampacker.app`, including
   `www` and any AAAA record. Screenshot or export the zone.
3. `[Mac]` `dig +short A grampacker.app; dig +short AAAA grampacker.app` and
   record the output.
4. Confirm Worker deployment is still off. The merge order in 6.1 stopped it
   before the Node/SQLite code reached `main`. Read-only:

   ```bash
   # [Mac]
   gh workflow list --all --repo "$GH_REPO"
   gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?status=in_progress" --jq .total_count
   gh api "repos/$GH_REPO/actions/workflows/deploy.yml/runs?status=queued" --jq .total_count
   gh api "repos/$GH_REPO/deployments?environment=production&per_page=1" \
     --jq '.[0] | [.sha, .created_at] | @tsv'
   npx wrangler deployments list --name grampacker
   ```

   Expected: both counts are `0`, and the GitHub record and the newest
   Cloudflare deployment are the ones recorded in 6.1. If 6.1's recommended step was done, `deploy.yml`
   and `deploy-liveness.yml` show `disabled_manually`. If anything else
   shows, stop and find out why before the window.

5. Have the empty-database rehearsal (7.4) passed with the image that will
   become production, and two import rehearsals (section 10) passed.
6. Confirm backups. They are set up outside this runbook, but the cutover
   depends on them: the existing setup must copy a backup-API snapshot of
   `/srv/grampacker/data` (never the live database and WAL files) to B2, and
   one such snapshot must have been restored from B2 and passed
   `integrity_check`. If not, do not start the cutover.

### 11.1 Freeze writes to D1 (CONFIRM: Worker route)

`[Cloudflare]` Workers & Pages, `grampacker`, Settings, Domains & Routes:

1. Remove the custom domain `grampacker.app`. Cloudflare deletes the DNS
   record it manages for it.
2. Disable the `workers.dev` route and preview URLs. Its CSRF origin check
   stops browsers, but a non-browser client can send any `Origin`, so the
   route itself must go.

Verify:

```bash
# [Mac]
dig +short A grampacker.app
dig +short AAAA grampacker.app
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://grampacker.app/api/health
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://grampacker.<WORKERS_SUBDOMAIN>.workers.dev/api/health
```

Expected: no A or AAAA answer (or only caches expiring within minutes); the
two `curl` commands fail or return a Cloudflare error, never `200`. Wait for
any cached answer to expire before 11.2. From this moment users see an
outage.

Undo: re-add the custom domain and re-enable `workers.dev` (11.9).

### 11.2 Export from D1 (Mac)

Read-only on D1. Uses the Mac's `wrangler login`.

```bash
# [Mac] in the repository checkout
STAMP=$(date -u +%Y%m%dT%H%MZ)
OUT=~/grampacker-d1-export/$STAMP
mkdir -p "$OUT" && chmod 700 "$OUT"
npx wrangler d1 time-travel info grampacker | tee "$OUT/time-travel-bookmark.txt"
npx wrangler d1 export grampacker --remote --output "$OUT/d1-full.sql"
npx wrangler d1 export grampacker --remote --no-schema --output "$OUT/d1-data.sql"
npx wrangler d1 execute grampacker --remote --json --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id" > "$OUT/d1-ledger.json"
npx wrangler d1 execute grampacker --remote --json --command "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name" > "$OUT/d1-schema.json"
npx wrangler d1 execute grampacker --remote --json --command "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" > "$OUT/d1-tables.json"
jq -r '[.[0].results[].name | "SELECT '\''\(.)'\'' AS t, COUNT(*) AS n FROM \"\(.)\""] | join(" UNION ALL ")' "$OUT/d1-tables.json" > "$OUT/d1-rowcount-query.sql"
npx wrangler d1 execute grampacker --remote --json --command "$(cat "$OUT/d1-rowcount-query.sql")" > "$OUT/d1-rowcounts.json"
grep -nE '^(BEGIN|COMMIT|PRAGMA)' "$OUT/d1-data.sql" | head
(cd "$OUT" && shasum -a 256 * > SHA256SUMS && cat SHA256SUMS)
echo "$OUT"
```

Expected: the bookmark file holds a bookmark; both `.sql` files are non-empty;
`d1-ledger.json` lists every migration in `migrations/`; the row-count file has
one entry per table. The `grep` line shows whether the export has its own
`BEGIN`/`COMMIT` (the import command must handle what it shows, as rehearsed).

Rerun: safe (read-only), but use a new `<STAMP>` so files are never mixed.

Archive: copy the whole `$OUT` folder to your encrypted backup location off
the VPS now. `d1-full.sql` is the untouched archive and is never edited.

### 11.3 Transfer to the VPS

```bash
# [VPS joe]
sudo install -d -o joe -g joe -m 0700 /srv/grampacker/import
install -d -m 0700 /srv/grampacker/import/<STAMP>
```

```bash
# [Mac]
scp -p "$OUT"/* joe@"$VPS_HOST":/srv/grampacker/import/"$STAMP"/
```

```bash
# [VPS joe]
cd /srv/grampacker/import/<STAMP> && sha256sum -c SHA256SUMS
sudo chown -R <APP_UID>:<APP_UID> /srv/grampacker/import/<STAMP>
```

Expected: every line `OK`. Rerun: safe.

### 11.4 Import into a new SQLite file

The production `app` must not be running while production is prepared.

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env stop app
docker run --rm --network none --user <APP_UID>:<APP_UID> \
  -v /srv/grampacker/import/<STAMP>:/import:ro \
  -v /srv/grampacker/data:/data \
  ghcr.io/joes703/grampacker@<APP_DIGEST> <IMPORT_COMMAND> \
  --export /import/d1-data.sql \
  --d1-schema /import/d1-schema.json \
  --d1-rowcounts /import/d1-rowcounts.json \
  --out /data/grampacker.db.import \
  | tee /srv/grampacker/import/<STAMP>-import-report.txt
echo "exit=${PIPESTATUS[0]}"
```

`<IMPORT_COMMAND>` and its option names are set by the implementation
(section 4). Expected: `exit=0`, and the report shows: schema match,
`integrity_check` `ok`, `foreign_key_check` empty, every invariant check
passed, every table's row count equal to D1's (after the deletion of
sessions, verification rows and rate-limit rows, which are listed
separately), and the passkey comparison identical.

If `exit` is not 0: stop. D1 is unchanged and still authoritative. Go to 11.9.

Rerun: safe. It refuses to overwrite an existing `grampacker.db.import`;
delete that file first to start again.

### 11.5 Switch the VPS to production configuration

Production keeps the **existing** `BETTER_AUTH_SECRET`; rotating it is a
separate, later operation. Cloudflare cannot show a Worker secret after it is
set, so type it from your password manager. If you have no copy, stop: the
move would then force a rotation, which needs its own decision.

```bash
# [VPS joe]
umask 077
read -rsp 'Existing production BETTER_AUTH_SECRET: ' AUTH_SECRET; echo
read -rsp 'Resend API key: ' RESEND_KEY; echo
{
  printf 'BETTER_AUTH_URL=%s\n' 'https://grampacker.app'
  printf 'BETTER_AUTH_SECRET=%s\n' "$AUTH_SECRET"
  printf 'RESEND_API_KEY=%s\n' "$RESEND_KEY"
  printf 'EMAIL_FROM=%s\n' 'grampacker <no-reply@grampacker.app>'
} > /srv/grampacker/secrets/app.env
unset AUTH_SECRET RESEND_KEY
stat -c '%U:%G %a %n' /srv/grampacker/secrets/app.env
grep -c '=' /srv/grampacker/secrets/app.env
```

Expected: `joe:joe 600` and `4`. Do not `cat` the file.

```bash
# [VPS root]
cd /srv/grampacker
ls -la data/
```

Expected: only `grampacker.db.import` (no `.import-wal` or `.import-shm`,
and no `grampacker.db`, `-wal` or `-shm`). If anything else is there, stop.
Then promote the import and keep a copy of it, made while nothing runs:

```bash
# [VPS root]
cd /srv/grampacker
mv data/grampacker.db.import data/grampacker.db
mkdir rollback/cutover-imported-<STAMP>
cp -a data rollback/cutover-imported-<STAMP>/data
ls -la rollback/cutover-imported-<STAMP>/data
```

Caddy is not started yet. It starts in 11.7, after DNS points here: starting
it earlier makes Caddy request a certificate that cannot succeed, and its
retry backoff (and Let's Encrypt's failed-validation limit) could then delay
the real request.

### 11.6 Start and test locally on the VPS

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env up -d app
docker compose --env-file deploy.env ps
curl -sS -o /tmp/health.json -w '%{http_code}\n' -H 'Host: grampacker.app' http://127.0.0.1:3000/api/health; cat /tmp/health.json; echo
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Host: grampacker.app' http://127.0.0.1:3000/
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: grampacker.app' http://127.0.0.1:3000/api/categories
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Host: grampacker.app' -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/categories
```

Expected: `app (healthy)`; `200` and `{"ok":true}`; `200 text/html...`;
`401`; `403`.

### 11.7 Point DNS at the VPS (CONFIRM: production DNS)

`[Cloudflare]` DNS, Records, Add record:

- Type `A`, Name `@` (`grampacker.app`), IPv4 address: the value of
  `$VPS_HOST`.
- Proxy status: **DNS only**.
- TTL: 1 min.
- **No AAAA record.** Confirm none remains from the Worker.

```bash
# [Mac]
dig +short A grampacker.app @1.1.1.1
dig +short AAAA grampacker.app @1.1.1.1
```

Expected: the VPS address, then nothing.

Now start Caddy with the production Caddyfile installed in 7.2:

```bash
# [VPS root]
grampacker-deploy caddy-update
```

Expected: `Caddy updated: sha256:..., answering 200`. It waits one minute for
the certificate. If it reports another status, Caddy is still running; read
its log (below) before anything else.

**Check, do not assume: `www`.** This runbook does not know whether
`www.grampacker.app` exists. Look at the Cloudflare DNS records recorded in
11.0. If there is no `www` record, do nothing. If there is one, stop and
decide what it should do before continuing; do not create one.

```bash
# [VPS root]
docker compose --env-file /srv/grampacker/deploy.env logs -f caddy
```

Expected: within a few minutes, "certificate obtained successfully" for
`grampacker.app`. Press Ctrl-C to stop following.

Undo: delete the A record (11.9).

### 11.8 Verify production, then open

From now on the site is reachable, with no maintenance bypass. That is
acceptable: there are only three test accounts, and the checks below are
their writes. If 11.9 rollback happens, those test writes are discarded.

```bash
# [Mac]
curl -sS -w '\n%{http_code}\n' https://grampacker.app/api/health
curl -sS -o /dev/null -w '%{http_code} %{http_version}\n' https://grampacker.app/
curl -sS -o /dev/null -w '%{http_code}\n' http://grampacker.app/
curl -sS -o /dev/null -w '%{http_code}\n' https://grampacker.app/api/categories
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://grampacker.app/api/categories
curl -sSI https://grampacker.app/ | grep -iE '^(strict-transport-security|content-security-policy|x-content-type-options|alt-svc):'
nc -vz -w 5 "$VPS_HOST" 3000; echo "exit=$?"
```

Expected: `{"ok":true}` `200`; `200 2`; `308`; `401`; `403`; the security
headers and no `alt-svc: h3`; port 3000 closed.

In a browser (a fresh private window, since old sessions are deliberately
invalid):

1. Sign in with an existing passkey. Expected: works.
2. Sign out; sign in with a magic link. Expected: the link points to
   `https://grampacker.app/` and works.
3. Open lists, gear and food pages, and follow a deep link directly.
4. Open an existing public share link signed out. Expected: it shows the
   shared list only.
5. Inspect the session cookie: `Secure`, `HttpOnly`, `SameSite=Strict`, host
   `grampacker.app`.

When all pass, the site is open. Record the time: **after this moment, D1 is
stale** and returning to it loses writes.

### 11.9 Rollback

**Before 11.8 finishes** (no real writes yet), rollback is safe:

1. `[Cloudflare]` Delete the VPS A record (CONFIRM).
2. `[Cloudflare]` Re-add the Worker custom domain `grampacker.app`, and
   restore `workers.dev` and preview URLs to the state recorded in 11.0
   (CONFIRM).
3. `[Mac]` `curl -sS https://grampacker.app/api/health` returns
   `{"ok":true}` from the Worker.
4. `[VPS root]` `docker compose --env-file /srv/grampacker/deploy.env stop app`.
   Keep the failed import and its report for diagnosis.
5. D1 is authoritative and was never written. Rollback is the Worker that
   is already running; it keeps serving its last version. Do **not** turn
   `deploy.yml` back on, and never re-run an earlier Deploy run: `main`
   contains Node/SQLite code, and either can deploy code the Worker cannot
   run (6.1, "Merge order").

**After 11.8** (real writes on SQLite): do not return to D1. Fix forward,
or follow 9.3, which needs a written decision first.

## 12. After cutover

### 12.1 Delete copies of production data

Staging (section 10) is not built. If it is built and used, its retirement
is written together with it.

The rehearsal export folders under `/srv/grampacker/import/` are also copies of
production data. Delete them now (`rm -rf /srv/grampacker/import/<rehearsal
STAMP>`). Keep the cutover export folder until the end of the observation
period, then delete it too; its untouched archive already lives off the VPS
(11.2).

### 12.2 Observe for two weeks

Daily for the first week, then weekly:

```bash
# [Mac]
curl -sS -w ' %{http_code}\n' https://grampacker.app/api/health
```

```bash
# [VPS joe]
df -h /
free -h
sudo docker stats --no-stream
sudo docker compose --env-file /srv/grampacker/deploy.env ps
sudo docker compose --env-file /srv/grampacker/deploy.env logs --since 24h app | grep -ciE 'error|fatal'
sudo docker image ls
```

Integrity, on the newest rollback copy (never on the live file, whose
`-wal` and `-shm` files belong to the running app):

```bash
# [VPS root]
ls /srv/grampacker/rollback
sqlite3 -readonly /srv/grampacker/rollback/<newest stamp>/data/grampacker.db 'PRAGMA integrity_check'
```

Expected: `ok`. The copy is from the last deploy; Kopia's backups cover
the time since. Also confirm
Kopia's B2 backups arrive, and do one restore test.

### 12.3 Decommission (separate approvals)

Each is its own decision, after the observation period:

- Remove Worker deployment code, `wrangler`, and Cloudflare-only dependencies
  (a normal PR).
- `[GitHub web]` Delete `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- `[Resend]` Revoke the old Worker's API key.
- Replace `docs/d1-restore.md` with the SQLite restore procedure.
- Archive a final D1 export (11.2 commands, new `<STAMP>`).
- Delete the D1 database: **only** with separate, explicit approval.

## 13. Records to fill in

| Item | Value |
| --- | --- |
| VPS host key fingerprint (ED25519) | |
| Caddy version after each `caddy-update` | |
| Image runtime UID | |
| Baseline before the merges: `<BASELINE_TIME>`, GitHub record (SHA, time), newest Cloudflare deployment (version id, time) | |
| Deployment-safety merge: `<MERGE_SHA>`, skipped Deploy run URL | |
| Migration merge: `<MERGE_SHA>`, Deploy run URL (or none, if disabled) | |
| First published image: `<APP_SHA>`, `<APP_DIGEST>`, run URL | |
| Staging memory, idle / busy | |
| Rehearsal 1: export, transfer, import, validation times | |
| Rehearsal 2: same | |
| Cutover window start / site open / D1 stale from | |
| GHCR token expiry date | |
