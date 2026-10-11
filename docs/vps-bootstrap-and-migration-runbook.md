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
| `<CADDY_VERSION>` | A Caddy 2.x release at least two weeks old, for example `2.10.2` |
| `<APP_DIGEST>` | A Grampacker image digest, `sha256:` plus 64 hex characters |
| `<APP_UID>` | Numeric UID of the image's non-root user (found in step 7.1) |
| `<ACME_EMAIL>` | The address Let's Encrypt uses for expiry notices |
| `<STAMP>` | A UTC time stamp such as `20261101T1530Z`, one per export |
| `<CADDY_DIGEST>` | The Caddy image digest recorded in step 3.2 |
| `<WORKERS_SUBDOMAIN>` | The account's `workers.dev` subdomain, shown in the Cloudflare dashboard |
| `<MIGRATE_COMMAND>`, `<SNAPSHOT_COMMAND>`, `<IMPORT_COMMAND>` | Commands inside the image, named by the implementation (section 4) |

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

GitHub Actions will pin this key later (step 8.4). Read it from the console,
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
| 3 | Deployment SSH key | GitHub: `production` environment secret (Pro) or repository secret (no Pro) | `deploy` | run the deploy wrapper with one image digest; nothing else | step 8 |
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

### 3.2 Choose and pin the Caddy image

Pick a Caddy 2.x release at least two weeks old from
<https://github.com/caddyserver/caddy/releases>. Then record its digest.

```bash
# [VPS joe]
sudo docker pull caddy:<CADDY_VERSION>
sudo docker image inspect --format '{{index .RepoDigests 0}}' caddy:<CADDY_VERSION>
```

Expected: a line such as `caddy@sha256:...`. The full pinned reference used
below is `caddy:<CADDY_VERSION>@sha256:<that digest>`.

Rerun: safe. Pulling again changes nothing for the same version.

### 3.3 Prove that a Docker port bound to 127.0.0.1 is not public

Docker writes its own packet-filter rules, and they run before UFW's. A port
published as `"8099:80"` would be reachable from the internet even though UFW
has no rule for it. This test proves the `127.0.0.1:` form is not.

```bash
# [VPS joe]
sudo docker run -d --rm --name bindtest -p 127.0.0.1:8099:80 caddy:<CADDY_VERSION> caddy respond --listen :80 "bindtest ok"
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

### 3.5 Install `jq` (optional)

The checks below avoid `jq` on the VPS. If you want it for your own
inspection: `sudo apt-get install -y jq`. Rerun: safe.

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
| Snapshot command | Runs inside the image, uses SQLite's backup API to copy `/data/grampacker.db` to a named file under `/snapshots`, then runs `PRAGMA integrity_check` on the copy and exits non-zero unless it returns `ok`. |
| D1 import command | Runs inside the image with `--network none`. Implements the plan's "Import" steps 1 to 15, writes a new database file (never overwrites an existing one), and prints a report: schema comparison, `integrity_check`, `foreign_key_check`, invariant checks, rows in the export against rows loaded per table (must always match), per-table counts against the D1 counts (must match, except with `--rehearsal`, where a difference is reported for the operator to review but does not fail the run), deleted transient rows, passkey field comparison. Before reporting success it checkpoints, closes every connection, and leaves a self-contained file: no `-wal` or `-shm` file beside it. Exits non-zero if any check fails. |
| Client address | The application reads the last `X-Forwarded-For` entry, which Caddy writes, and no longer reads `cf-connecting-ip`. |
| Configuration | A documented list of environment variables. Known today: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. The database path and port are expected to have fixed defaults (`/data/grampacker.db`, `3000`). |
| Deploy script | `/usr/local/sbin/grampacker-deploy <APP_DIGEST>`, run as root. Steps in section 9. Validates its argument against `^sha256:[0-9a-f]{64}$`. Tags the running image `grampacker-local:current` and the one before it `grampacker-local:previous`, so `docker image prune` cannot delete the rollback image. Appends one line per deployment to `/srv/grampacker/deploy-history.log`. |
| SSH wrapper | `/usr/local/sbin/grampacker-deploy-ssh`, the forced command for the `deploy` key. Reads `SSH_ORIGINAL_COMMAND`, accepts exactly one digest, and runs `sudo /usr/local/sbin/grampacker-deploy "$digest"`. Anything else exits non-zero without side effects. |
| Maintenance response | Mechanism designed with the real Compose files. Required behavior: 503 for every path including `/api/*` while on; works with the app container stopped; survives a Caddy restart in the state it was left in; switched by one documented command each way; provable with one `curl` from outside. |
| CI | Pull requests build the image (no push) in addition to today's checks. |
| Publish-and-deploy workflow | `workflow_dispatch`; checks out `refs/heads/main`; verifies `ci.yml` succeeded for that exact SHA (same API check as today's `deploy.yml`); builds `linux/amd64`; pushes `$IMAGE_REPO:<full SHA>` with the label `org.opencontainers.image.source=https://github.com/joes703/grampacker`; prints the digest; every job carries `if: github.ref == 'refs/heads/main'`, so a dispatch from any other branch runs nothing; then, unless the boolean input `deploy` is false, a separate job (in the `production` environment when Pro is available) runs SSH with a pinned host key and sends only the digest. One concurrency group, never canceled in progress. |

Until these exist and are merged, sections 7 to 12 cannot run.

## 5. GitHub settings (GitHub web)

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

- **Pro:** do 5.2, and in 8.4 use the environment commands.
- **No Pro:** skip 5.2, and in 8.4 use the repository-secret commands.

### 5.2 Create the `production` environment (CONFIRM, needs Pro)

`[GitHub web]` Repository Settings, Environments, New environment:

1. Name: `production`.
2. Deployment branches and tags: **Selected branches and tags**, add the rule
   `main` only.
3. Required reviewers: optional. Adding yourself means each deploy waits for
   one more click; useful, not required.
4. Leave secrets empty for now; step 8 adds them.

Verify: the environment page shows "1 branch rule: main".

Undo: delete the environment (its secrets go with it).

Rerun: safe; editing an existing environment has the same result.

## 6. GHCR access

### 6.1 Publishing (GitHub Actions, AFTER IMAGE)

`[GitHub Actions]` The publish workflow pushes with its own short-lived
`GITHUB_TOKEN` (`packages: write`). No personal token is involved.

Run it with the input `deploy` set to false until section 8 is complete: the
VPS cannot accept a deployment before then. That run publishes the image and
prints its digest only.

After its first successful run:

`[GHCR]` Your profile, Packages, `grampacker`:

1. Confirm the package is **Private** and linked to `joes703/grampacker`.
2. Package settings, "Manage Actions access": the `grampacker` repository has
   **Write**. No other repository is listed.

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

## 7. Compose, Caddy and staging (AFTER IMAGE)

### 7.1 Find the image's runtime UID and hand it the data directories

```bash
# [VPS joe]
sudo docker run --rm --entrypoint id "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: a non-zero UID, for example `uid=10001(app) gid=10001(app)`. Use
that number as `<APP_UID>`. If it prints `uid=0`, stop: the image runs as root.

```bash
# [VPS joe]
sudo chown <APP_UID>:<APP_UID> /srv/grampacker/data /srv/grampacker/snapshots
sudo chmod 0700 /srv/grampacker/data /srv/grampacker/snapshots
sudo stat -c '%u:%g %a %n' /srv/grampacker/data /srv/grampacker/snapshots
```

Expected: `<APP_UID>:<APP_UID> 700` for both. `joe` now needs `sudo` to read
them, which is intended. Rerun: safe.

### 7.2 Write `deploy.env`

No secrets; it records which images run.

```bash
# [VPS joe]
tee /srv/grampacker/deploy.env >/dev/null <<'EOF'
APP_IMAGE=ghcr.io/joes703/grampacker@<APP_DIGEST>
CADDY_IMAGE=caddy:<CADDY_VERSION>@sha256:<CADDY_DIGEST>
ACME_EMAIL=<ACME_EMAIL>
EOF
chmod 0644 /srv/grampacker/deploy.env
cat /srv/grampacker/deploy.env
```

Replace the three placeholders in the heredoc before running it. Expected: the
file shows the real values and no `<...>` remains. Rerun: safe; it overwrites
the file with the same contents. After the first deploy, only the deploy
script edits `APP_IMAGE`.

### 7.3 Write `compose.yaml`

The application port names `127.0.0.1`; that is what keeps it off the
internet (step 3.3). Caddy uses host networking, so Docker publishes nothing
for it and UFW's 80/443 rules apply normally.

```bash
# [VPS joe]
tee /srv/grampacker/compose.yaml >/dev/null <<'EOF'
name: grampacker

services:
  app:
    image: ${APP_IMAGE:?set APP_IMAGE in deploy.env}
    env_file:
      - ./secrets/app.env
    ports:
      # 127.0.0.1 only. A bare "3000:3000" would bypass UFW and be public.
      - "127.0.0.1:3000:3000"
    volumes:
      - ./data:/data
    read_only: true
    tmpfs:
      - /tmp
    restart: unless-stopped
    stop_grace_period: 20s
    logging:
      driver: local
      options:
        max-size: 10m
        max-file: "3"

  caddy:
    image: ${CADDY_IMAGE:?set CADDY_IMAGE in deploy.env}
    # Host networking: Caddy sees the real client address and reaches the
    # app on 127.0.0.1:3000. Docker publishes no port for it.
    network_mode: host
    environment:
      ACME_EMAIL: ${ACME_EMAIL:?set ACME_EMAIL in deploy.env}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy/data:/data
      - ./caddy/config:/config
    restart: unless-stopped
    logging:
      driver: local
      options:
        max-size: 10m
        max-file: "3"
EOF
```

The file is validated at the end of 7.5, because it refers to
`secrets/app.env`, which does not exist yet. No memory limit yet: measure
first (section 13).

The maintenance mechanism (section 4) may add a mount or a file to this
Compose file. Add it here when it is designed, in the same PR that writes it.

Rerun: safe.

### 7.4 Write the staging `Caddyfile`

```bash
# [VPS joe]
tee /srv/grampacker/Caddyfile >/dev/null <<'EOF'
{
	email {$ACME_EMAIL}
	servers {
		# UDP 443 is closed on purpose; do not advertise HTTP/3.
		protocols h1 h2
	}
}

staging.grampacker.app {
	# Above the app's largest limit (2 MB on the import routes), so the app
	# still decides and reports 413 itself.
	request_body {
		max_size 4MB
	}
	# Caddy sets X-Forwarded-For to the connection's address, replacing what
	# the client sent; the app reads only its last entry. Do not add
	# trusted_proxies: it would make Caddy keep client-supplied entries.
	reverse_proxy 127.0.0.1:3000
}
EOF
sudo docker run --rm -v /srv/grampacker/Caddyfile:/etc/caddy/Caddyfile:ro -e ACME_EMAIL=test@example.invalid caddy:<CADDY_VERSION> caddy validate --config /etc/caddy/Caddyfile
```

Expected: `Valid configuration`. Rerun: safe.

### 7.5 Write the staging secrets

Staging has its own `BETTER_AUTH_SECRET`, generated on the VPS so it never
travels. The Resend key is typed, not pasted into a file or the history.

```bash
# [VPS joe]
umask 077
read -rsp 'Resend API key: ' RESEND_KEY; echo
{
  printf 'BETTER_AUTH_URL=%s\n' 'https://staging.grampacker.app'
  printf 'BETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)"
  printf 'RESEND_API_KEY=%s\n' "$RESEND_KEY"
  printf 'EMAIL_FROM=%s\n' 'grampacker <no-reply@grampacker.app>'
} > /srv/grampacker/secrets/app.env
unset RESEND_KEY
stat -c '%U:%G %a %n' /srv/grampacker/secrets/app.env
grep -c '=' /srv/grampacker/secrets/app.env
```

Expected: `joe:joe 600`, and `4`. Do not `cat` the file.

Now validate the Compose file from 7.3:

```bash
# [VPS joe]
cd /srv/grampacker && sudo docker compose --env-file deploy.env config --quiet && echo "compose OK"
```

Expected: `compose OK`.

Add any further variable the implementation documents (section 4,
"Configuration") the same way.

Use a new Resend key restricted to sending for `grampacker.app`, not the key
the Worker uses, so the two can be revoked separately.

Rerun: **not idempotent**: it replaces the staging secret, which signs out
every staging session. That is harmless on staging.

### 7.6 Create the staging DNS record (CONFIRM)

Changes DNS. Does not touch `grampacker.app` itself.

`[Cloudflare]` DNS, Records, Add record:

- Type `A`, Name `staging`, IPv4 address: the value of `$VPS_HOST`.
- Proxy status: **DNS only** (grey cloud).
- TTL: 1 min (60 s).
- No AAAA record.

Verify:

```bash
# [Mac]
dig +short A staging.grampacker.app
dig +short AAAA staging.grampacker.app
```

Expected: the VPS address, then nothing.

Undo: delete the record.

### 7.7 Start staging

```bash
# [VPS joe]
cd /srv/grampacker
sudo docker compose --env-file deploy.env run --rm --no-deps app <MIGRATE_COMMAND>
sudo docker compose --env-file deploy.env up -d
sudo docker compose --env-file deploy.env ps
```

`<MIGRATE_COMMAND>` is the migrate command from section 4. On an empty `data/`
it creates a fresh database.

Expected: `app` shows `(healthy)` within about a minute; `caddy` is `running`.

```bash
# [VPS joe]
sudo docker compose --env-file deploy.env logs --tail 50 caddy
```

Expected: a line saying the certificate for `staging.grampacker.app` was
obtained. If it failed, check DNS (7.6) and that UFW allows TCP 80 and 443.

Rerun: safe. `up -d` changes only what differs.

Stop staging: `sudo docker compose --env-file deploy.env down` (keeps `data/`
and the certificates).

### 7.8 Verify staging

Health, with the strict rule (status 200 **and** body exactly `{"ok":true}`):

```bash
# [VPS joe]
curl -sS -o /tmp/health.json -w '%{http_code}\n' -H 'Host: staging.grampacker.app' http://127.0.0.1:3000/api/health
cat /tmp/health.json; echo
```

Expected: `200`, then `{"ok":true}`.

From outside:

```bash
# [Mac]
curl -sS -o /dev/null -w '%{http_code} %{http_version}\n' https://staging.grampacker.app/
curl -sS -w '\n%{http_code}\n' https://staging.grampacker.app/api/health
curl -sS -o /dev/null -w '%{http_code}\n' https://staging.grampacker.app/api/categories
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://staging.grampacker.app/api/categories
curl -sS -o /dev/null -w '%{http_code}\n' http://staging.grampacker.app/
curl -sSI https://staging.grampacker.app/ | grep -iE '^(strict-transport-security|content-security-policy|x-content-type-options|alt-svc):'
nc -vz -w 5 "$VPS_HOST" 3000; echo "exit=$?"
```

Expected, in order:

1. `200 2` (HTTP/2).
2. `{"ok":true}` then `200`.
3. `401` (anonymous API read refused).
4. `403` (CSRF: no `x-grampacker-request` header; refused before auth).
5. `308` (HTTP redirects to HTTPS).
6. The security headers the app sets today, and **no** `alt-svc: h3` line.
7. Port 3000 refused or timed out, `exit=1`.

Also in a browser: open `https://staging.grampacker.app/`, follow a deep link
(for example `/lists/anything`), and confirm a static asset under `/assets/`
loads.

Measure memory now and after a few minutes of use:

```bash
# [VPS joe]
sudo docker stats --no-stream
free -h
```

Record the numbers in section 13.

## 8. Deployment account and GitHub deployment key (CONFIRM, needs section 4)

### 8.1 Install the deploy script and wrapper

The two scripts come from the repository at a merged `main` commit. Copy them
from a checkout on the Mac, then install them as root-owned files that
`deploy` cannot change.

```bash
# [Mac] in a clean checkout of main
git -C ~/code/grampacker fetch origin && git -C ~/code/grampacker status --short
scp <PATH_TO_DEPLOY_SCRIPT> <PATH_TO_SSH_WRAPPER> joe@"$VPS_HOST":/tmp/
shasum -a 256 <PATH_TO_DEPLOY_SCRIPT> <PATH_TO_SSH_WRAPPER>
```

```bash
# [VPS root]
sha256sum /tmp/<deploy script name> /tmp/<wrapper name>
install -o root -g root -m 0755 /tmp/<deploy script name> /usr/local/sbin/grampacker-deploy
install -o root -g root -m 0755 /tmp/<wrapper name> /usr/local/sbin/grampacker-deploy-ssh
rm -f /tmp/<deploy script name> /tmp/<wrapper name>
```

Expected: both hash lists match exactly. Rerun: safe; it reinstalls the same
files. Repeat this step whenever either script changes on `main`.

### 8.2 Create the `deploy` account

```bash
# [VPS root]
adduser --disabled-password --gecos 'grampacker GitHub deploy' deploy
tee /etc/sudoers.d/80-grampacker-deploy >/dev/null <<'EOF'
# The deploy key may run exactly one root command. The script validates its
# own argument; sudo does not.
deploy ALL=(root) NOPASSWD: /usr/local/sbin/grampacker-deploy
EOF
chmod 0440 /etc/sudoers.d/80-grampacker-deploy
visudo -c
id deploy
```

Expected: `parsed OK` for every file; `deploy` is in no group except its own
(not `sudo`, not `docker`).

Rerun: `adduser` fails if the account exists; that is harmless. The `tee`
lines are safe to rerun.

### 8.3 Generate and install the deployment key

Generated on the Mac in a temporary folder; the private half goes to GitHub
and is then deleted from the Mac.

```bash
# [Mac]
KEYDIR=$(mktemp -d)
ssh-keygen -t ed25519 -N '' -C 'grampacker-github-deploy' -f "$KEYDIR/gha_deploy"
cat "$KEYDIR/gha_deploy.pub"
```

```bash
# [VPS root] paste the .pub line where shown; it is not a secret
install -d -o deploy -g deploy -m 0700 /home/deploy/.ssh
tee /home/deploy/.ssh/authorized_keys >/dev/null <<'EOF'
restrict,command="/usr/local/sbin/grampacker-deploy-ssh" PASTE_THE_DEPLOY_PUBLIC_KEY_LINE_HERE
EOF
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 0600 /home/deploy/.ssh/authorized_keys
```

`restrict` turns off shells, port forwarding, agent forwarding and X11;
`command=` makes the wrapper the only thing the key can run.

Test from the Mac before the key goes anywhere:

```bash
# [Mac]
ssh -o IdentitiesOnly=yes -i "$KEYDIR/gha_deploy" deploy@"$VPS_HOST" 'bash -i'; echo "exit=$?"
ssh -o IdentitiesOnly=yes -i "$KEYDIR/gha_deploy" deploy@"$VPS_HOST" 'not-a-digest'; echo "exit=$?"
ssh -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -i "$KEYDIR/gha_deploy" -N -R 9000:127.0.0.1:22 deploy@"$VPS_HOST"; echo "exit=$?"
```

Expected: the first two print the wrapper's refusal and a non-zero exit with
no shell; the third prints `remote port forwarding failed` and `exit=255`.
Nothing deploys.

### 8.4 Store the key and pinned host key in GitHub

```bash
# [Mac]
ssh-keyscan -t ed25519 "$VPS_HOST" 2>/dev/null | tee "$KEYDIR/known_hosts"
ssh-keygen -lf "$KEYDIR/known_hosts"
```

Expected: the fingerprint equals the one recorded from the console in 1.2. If
not, stop.

`[GitHub web]` With Pro: Settings, Environments, `production`. Without Pro:
Settings, Secrets and variables, Actions. Add:

- Secret `VPS_SSH_KEY`: the full contents of `$KEYDIR/gha_deploy`.
- Secret `VPS_KNOWN_HOSTS`: the one line in `$KEYDIR/known_hosts`.
- Variable `VPS_HOST`: the VPS address.
- Variable `VPS_DEPLOY_USER`: `deploy`.

Or from the Mac with `gh` (no copy-paste of the private key). With Pro:

```bash
# [Mac]
gh secret set VPS_SSH_KEY --env production --repo "$GH_REPO" < "$KEYDIR/gha_deploy"
gh secret set VPS_KNOWN_HOSTS --env production --repo "$GH_REPO" < "$KEYDIR/known_hosts"
gh variable set VPS_HOST --env production --repo "$GH_REPO" --body "$VPS_HOST"
gh variable set VPS_DEPLOY_USER --env production --repo "$GH_REPO" --body deploy
```

Without Pro, the same four commands without `--env production`.

Then delete the Mac copy:

```bash
# [Mac]
rm -rf "$KEYDIR"; unset KEYDIR
```

Rotate or revoke: `[VPS root]` remove the line from
`/home/deploy/.ssh/authorized_keys` (this alone stops the key), then repeat
8.3 and 8.4. Verify revocation with the first test command in 8.3, which must
now fail with `Permission denied (publickey)`.

## 9. Routine deployments (AFTER IMAGE)

### 9.1 What the deploy script does

`/usr/local/sbin/grampacker-deploy <APP_DIGEST>`, as root:

1. Take a lock (`flock` on `/srv/grampacker/.deploy.lock`); exit if another
   deploy holds it.
2. Pull `ghcr.io/joes703/grampacker@<APP_DIGEST>`.
3. Turn the maintenance response on; prove it with one request.
4. Stop the `app` service.
5. Snapshot `data/grampacker.db` to
   `snapshots/pre-deploy-<UTC stamp>-<old digest prefix>.db` with the
   snapshot command, which also checks `integrity_check`.
6. Run the migrate command with the **candidate** image.
7. Write the candidate into `deploy.env` and start it with
   `docker compose up -d app`.
8. Check, against `127.0.0.1:3000` with the production `Host` header:
   health (200 and exactly `{"ok":true}`), the SPA shell, one static asset,
   anonymous API read refused with 401, and a write without the CSRF header
   refused with 403.
9. Retag `current` and `previous`, and append a line to
   `deploy-history.log`: time, new digest, previous digest, snapshot path.
10. Turn the maintenance response off. This is the last step, so every
    earlier failure happens while the site is still closed.

If any of steps 1 to 9 fails, the script stops, **leaves maintenance on**, and
prints the failed step, the previous digest, the snapshot path, and the
recovery commands from 9.4. It does not restore anything by itself.

If step 10 itself fails, the script cannot tell whether traffic reopened. It
says so. Check with `curl` from outside: if the site answers normally, treat
it as reopened (9.5 applies to any database restore); if it still answers 503,
9.4 applies.

Rerun: safe for the same digest. Pending migrations are applied once; a
second run takes a new snapshot and restarts the same image.

### 9.2 Deploy through GitHub Actions

`[GitHub Actions]` Actions, the publish-and-deploy workflow, Run workflow, on
`main`. Watch both jobs. The run summary prints the digest it deployed.

Verify:

```bash
# [Mac]
curl -sS -w '\n%{http_code}\n' https://grampacker.app/api/health
ssh joe@"$VPS_HOST" 'tail -n 3 /srv/grampacker/deploy-history.log'
```

Expected: `{"ok":true}` and `200`; the last history line shows the new digest.

### 9.3 Deploy by hand (when the deploy job is unavailable)

This deploys an image that is **already published**. Producing a new image
needs Actions; with Actions up but SSH from GitHub failing, run the workflow
with `deploy` set to false and use the digest it prints. Otherwise use a
digest recorded in `deploy-history.log` or shown on the GHCR package page.

```bash
# [Mac]
ssh -t joe@"$VPS_HOST" 'sudo /usr/local/sbin/grampacker-deploy <APP_DIGEST>'
```

`-t` gives `sudo` a terminal so it can ask for `joe`'s password. Same
verification as 9.2.

### 9.4 When a deploy fails (maintenance is still on)

No public write has happened since the snapshot, so restoring it is safe.

1. Read the script's output: failed step, previous digest, snapshot path.
2. If the failure was before step 6 (no migration ran), only the image needs
   to go back:

   ```bash
   # [VPS root]
   cd /srv/grampacker
   sed -i "s|^APP_IMAGE=.*|APP_IMAGE=ghcr.io/joes703/grampacker@<PREVIOUS_DIGEST>|" deploy.env
   docker compose --env-file deploy.env up -d app
   ```

3. If a migration ran, restore the snapshot too. Move the current files aside
   rather than deleting them; the WAL and SHM files must not be left next to
   the restored database, or SQLite would apply them to it.

   ```bash
   # [VPS root]
   cd /srv/grampacker
   docker compose --env-file deploy.env stop app
   DEST=snapshots/failed-<STAMP>
   install -d -o <APP_UID> -g <APP_UID> -m 0700 "$DEST"
   mv data/grampacker.db "$DEST"/ && echo "database moved"
   for x in -wal -shm; do [ ! -e "data/grampacker.db$x" ] || mv "data/grampacker.db$x" "$DEST"/ || echo "FAILED to move grampacker.db$x"; done
   ls -la data/
   ```

   Expected: `database moved`, no `FAILED` line, and `ls` shows no
   `grampacker.db`, `grampacker.db-wal` or `grampacker.db-shm` file. If
   anything differs, stop here. Only then restore and start:

   ```bash
   # [VPS root]
   cd /srv/grampacker
   install -o <APP_UID> -g <APP_UID> -m 0600 snapshots/<SNAPSHOT_FILE> data/grampacker.db
   sed -i "s|^APP_IMAGE=.*|APP_IMAGE=ghcr.io/joes703/grampacker@<PREVIOUS_DIGEST>|" deploy.env
   docker compose --env-file deploy.env up -d app
   ```

4. Check health exactly as in 7.8 (200 and `{"ok":true}`) and the other
   step-8 checks of 9.1.
5. Only then turn maintenance off.

### 9.5 Restoring the database after traffic has reopened

**Manual judgment, every time.** Restoring a pre-deployment snapshot after
the public has written to the new database deletes those writes. Before
doing it, decide in writing: what is broken, what writes would be lost (the
time since reopening), and whether a fix-forward is possible instead. If the
answer is still "restore", turn maintenance on first, take a fresh snapshot
of the current state (it preserves the writes for manual recovery), then
follow 9.4 step 3.

### 9.6 Image cleanup

```bash
# [VPS joe]
sudo docker image ls
sudo docker image prune -f
```

`prune -f` (without `-a`) removes only untagged, unused images. The
`grampacker-local:current` and `:previous` tags keep the rollback image.
Never use `prune -a` here. Rerun: safe.

## 10. Staging with a copy of production (CONFIRM, production data)

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
4. **CONFIRM:** stop automatic Worker deployment before the first
   Node/SQLite change reaches `main` (not weeks earlier):

   ```bash
   # [Mac]
   gh workflow disable deploy.yml --repo "$GH_REPO"
   gh workflow disable deploy-liveness.yml --repo "$GH_REPO"
   gh workflow list --all --repo "$GH_REPO"
   gh run list --workflow deploy.yml --status in_progress --repo "$GH_REPO"
   gh run list --workflow deploy.yml --status queued --repo "$GH_REPO"
   ```

   Expected: both workflows show `disabled_manually`, and both run lists are
   empty. Disabling does not stop a run that already started: if either list
   shows a run, wait for it to finish or cancel it
   (`gh run cancel <run-id> --repo "$GH_REPO"`), then list again. Continue
   only when both lists are empty (the same drain as `docs/d1-restore.md`
   step 1). The Worker keeps serving its last
   deployment. Undo (only while `main` is still Worker code):
   `gh workflow enable` for each.

5. Have staging (section 7) running the image that will become production,
   with a rehearsal import that passed.
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

The production `app` is stopped; staging must not be serving the staging
copy while production is prepared.

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
} > /srv/grampacker/secrets/app.env.new
unset AUTH_SECRET RESEND_KEY
mv /srv/grampacker/secrets/app.env /srv/grampacker/secrets/app.env.staging
mv /srv/grampacker/secrets/app.env.new /srv/grampacker/secrets/app.env
```

```bash
# [VPS root]
cd /srv/grampacker
DEST=snapshots/staging-retired-<STAMP>
install -d -o <APP_UID> -g <APP_UID> -m 0700 "$DEST"
mv data/grampacker.db "$DEST"/ && echo "database moved"
for x in -wal -shm; do [ ! -e "data/grampacker.db$x" ] || mv "data/grampacker.db$x" "$DEST"/ || echo "FAILED to move grampacker.db$x"; done
ls -la data/
ls -la data/grampacker.db.import*
```

Expected: exactly as in 10.2. If anything differs, stop. Then promote the
import and take the first snapshot of it:

```bash
# [VPS root]
cd /srv/grampacker
mv data/grampacker.db.import data/grampacker.db
. ./deploy.env
docker run --rm --network none --user <APP_UID>:<APP_UID> -v /srv/grampacker/data:/data -v /srv/grampacker/snapshots:/snapshots "$APP_IMAGE" <SNAPSHOT_COMMAND> /data/grampacker.db /snapshots/cutover-imported-<STAMP>.db
```

Caddy still serves only the staging site. The production site is added in
11.7, after DNS points here: adding it earlier makes Caddy request a
certificate that cannot succeed, and its retry backoff (and Let's Encrypt's
failed-validation limit) could then delay the real request. While
`BETTER_AUTH_URL` is the production URL, staging still loads but its writes and
sign-ins fail the origin checks. That is expected.

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

Now add the production site to the Caddyfile, keeping staging until section 12,
and reload Caddy:

```bash
# [VPS joe]
tee /srv/grampacker/Caddyfile >/dev/null <<'EOF'
{
	email {$ACME_EMAIL}
	servers {
		# UDP 443 is closed on purpose; do not advertise HTTP/3.
		protocols h1 h2
	}
}

grampacker.app, staging.grampacker.app {
	# Above the app's largest limit (2 MB on the import routes), so the app
	# still decides and reports 413 itself.
	request_body {
		max_size 4MB
	}
	# Caddy sets X-Forwarded-For to the connection's address, replacing what
	# the client sent; the app reads only its last entry. Do not add
	# trusted_proxies: it would make Caddy keep client-supplied entries.
	reverse_proxy 127.0.0.1:3000
}
EOF
cd /srv/grampacker && sudo docker compose --env-file deploy.env exec caddy caddy reload --config /etc/caddy/Caddyfile
```

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
5. D1 is authoritative and was never written. Do **not** re-enable
   `deploy.yml` if `main` already contains Node/SQLite code: it would deploy
   code the Worker cannot run. The Worker keeps serving its last version.

**After 11.8** (real writes on SQLite): do not return to D1. Fix forward, or
run the previous image (9.4 step 2). Restoring a snapshot follows 9.5 and
needs a deliberate decision.

## 12. After cutover

### 12.1 Retire staging (CONFIRM: DNS)

```bash
# [VPS joe]
tee /srv/grampacker/Caddyfile >/dev/null <<'EOF'
{
	email {$ACME_EMAIL}
	servers {
		# UDP 443 is closed on purpose; do not advertise HTTP/3.
		protocols h1 h2
	}
}

grampacker.app {
	# Above the app's largest limit (2 MB on the import routes), so the app
	# still decides and reports 413 itself.
	request_body {
		max_size 4MB
	}
	# Caddy sets X-Forwarded-For to the connection's address, replacing what
	# the client sent; the app reads only its last entry. Do not add
	# trusted_proxies: it would make Caddy keep client-supplied entries.
	reverse_proxy 127.0.0.1:3000
}
EOF
cd /srv/grampacker && sudo docker compose --env-file deploy.env exec caddy caddy reload --config /etc/caddy/Caddyfile
```

`[Cloudflare]` Delete the `staging` A record.

```bash
# [VPS root]
rm -f /srv/grampacker/secrets/app.env.staging
rm -rf /srv/grampacker/snapshots/staging-retired-*
```

The last two lines delete the staging copy of production data, as the plan
requires. They do not touch `data/` or any pre-deploy or cutover snapshot.

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

Integrity, on a fresh snapshot (never on the live file):

```bash
# [VPS root]
cd /srv/grampacker
. ./deploy.env
docker run --rm --network none --user <APP_UID>:<APP_UID> -v /srv/grampacker/data:/data -v /srv/grampacker/snapshots:/snapshots "$APP_IMAGE" <SNAPSHOT_COMMAND> /data/grampacker.db /snapshots/check-$(date -u +%Y%m%dT%H%MZ).db
```

Expected: exit 0 (the snapshot command runs `integrity_check`). Also confirm
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
| Caddy version and digest | |
| Image runtime UID | |
| Staging memory, idle / busy | |
| Rehearsal 1: export, transfer, import, validation times | |
| Rehearsal 2: same | |
| Cutover window start / site open / D1 stale from | |
| GHCR token expiry date | |
