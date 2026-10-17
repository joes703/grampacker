# VPS runbook

This is the current operating and rebuild guide for Grampacker production.
Production is a Docker Compose stack on one Ubuntu VPS: the Node application,
SQLite and Caddy. Merging to `main` does not deploy.

Commands marked `[admin]` run on an administrator workstation. Commands marked
`[VPS root]` run after connecting to the VPS and becoming root.

## 1. System layout

| Item | Value |
| --- | --- |
| Public site | `https://grampacker.app` |
| Repository | `joes703/grampacker` |
| VPS directory | `/srv/grampacker` |
| Application image | exact `ghcr.io/joes703/grampacker@sha256:...` digest |
| Application listener | `127.0.0.1:3000` |
| Reverse proxy | `caddy:2`, host ports 80 and 443 |
| Database | `/srv/grampacker/data/grampacker.db` |
| Application secrets | `/srv/grampacker/secrets/app.env`, `root:root`, mode `0600` |
| Deploy configuration | `/srv/grampacker/deploy.env`, `root:root`, mode `0644` |
| Deploy rollbacks | `/srv/grampacker/rollback/<UTC timestamp>/` |

The app runs as UID/GID `10001:10001`, with a read-only root filesystem and a
tmpfs at `/tmp`. Only its SQLite directory is writable. Caddy uses host
networking. Port 3000 is bound to loopback; ports 80 and 443 are the only
public application ports.

`deploy.env` contains only the image digest and non-secret deployment values:

```dotenv
APP_IMAGE=ghcr.io/joes703/grampacker@sha256:<64 lowercase hex>
APP_PORT=3000
CADDYFILE=Caddyfile
SITE_URL=https://grampacker.app/
ACME_EMAIL=<certificate contact address>
```

`secrets/app.env` contains these names and their private values:

```dotenv
BETTER_AUTH_URL=https://grampacker.app
BETTER_AUTH_SECRET=<64 hex characters>
RESEND_API_KEY=<Resend API key>
EMAIL_FROM=<verified sender>
```

Never print `app.env` or put it in Git.

## 2. Inspect production

Start every production root shell by clearing the rehearsal override:

```bash
# [VPS root]
unset GRAMPACKER_ROOT
cd /srv/grampacker
```

Check the stack and the public endpoint:

```bash
docker compose --env-file deploy.env ps
docker compose --env-file deploy.env logs --since 1h app
docker compose --env-file deploy.env logs --since 1h caddy
curl -fsS https://grampacker.app/api/health && echo
```

After a start or restart, wait for Docker health before testing HTTP:

```bash
id="$(docker compose --env-file deploy.env ps -q app)"
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = healthy ]; do
  sleep 2
done
curl -fsS http://127.0.0.1:3000/api/health && echo
```

## 3. Deploy

Start the Image workflow on `main` with its `deploy` input enabled:

```bash
# [admin]
gh workflow run image.yml --repo joes703/grampacker --ref main -f deploy=true
gh run list --repo joes703/grampacker --workflow image.yml \
  --event workflow_dispatch --limit 1 --json databaseId,headSha,url
gh run watch <RUN_ID> --repo joes703/grampacker --exit-status
curl -fsS https://grampacker.app/api/health && echo
```

The workflow tests the exact commit, builds a `linux/amd64` image, publishes
it to GHCR, records its immutable digest and sends only that digest through
the restricted deployment key.

The VPS deploy script then:

1. pulls the digest;
2. enables maintenance mode;
3. stops the app;
4. copies the complete data directory and previous image into a timestamped
   rollback directory;
5. applies migrations with the new image;
6. starts and health-checks the new image;
7. disables maintenance mode.

For a manual deployment of a digest already published by a successful main
workflow run:

```bash
# [admin]
ssh -t grampacker-vps \
  'sudo /usr/local/sbin/grampacker-deploy deploy sha256:<64 lowercase hex>'
```

### Publish without deploying

Omit the input:

```bash
# [admin]
gh workflow run image.yml --repo joes703/grampacker --ref main
gh run list --repo joes703/grampacker --workflow image.yml \
  --event workflow_dispatch --limit 1 --json databaseId,headSha,status,url
```

The workflow log prints the published digest.

### Failed deploy

A failed deploy leaves maintenance mode on and prints whether it created a
rollback directory. If it did:

```bash
# [VPS root]
grampacker-deploy rollback /srv/grampacker/rollback/<timestamp>
# Check the app before reopening it.
grampacker-deploy maintenance off
```

If it failed before copying data, the data directory is unchanged. Restart
the prior app, wait for health, then turn maintenance off.

### Roll back after the site reopened

This loses production writes made after the rollback copy, although the
script retains the replaced data under `failed-data-<timestamp>`. Record what
is broken and why fix-forward is not suitable before proceeding:

```bash
# [VPS root]
grampacker-deploy maintenance on
grampacker-deploy rollback /srv/grampacker/rollback/<timestamp>
# Check the app, then reopen it explicitly.
grampacker-deploy maintenance off
```

The script refuses a rollback unless maintenance mode is already on.

## 4. Routine maintenance

### Caddy

```bash
# [VPS root]
grampacker-deploy caddy-update
```

This pulls the current `caddy:2`, validates the Caddyfile with that image,
recreates only Caddy and checks the response. Run it monthly and promptly
after a Caddy security release.

### Ubuntu and Docker

Unattended security updates stay enabled. Check at least monthly:

```bash
# [VPS root]
apt-get update
apt list --upgradable
apt-get upgrade --with-new-pkgs
test ! -e /var/run/reboot-required || cat /var/run/reboot-required.pkgs
```

Docker package upgrades may restart containers briefly. Reboot at a quiet
time when requested, then wait for app health and check the public endpoint.

Security fixes deploy as soon as practical, the same day when possible.
Other merged runtime dependency or base-image changes deploy within seven
days. Rebuilding an unchanged commit does not update a pinned dependency or
base image; its lockfile or Dockerfile digest must change first.

### Disk cleanup

Rollback directories and unused images are not removed automatically. Once a
deployment has been healthy long enough, retain the newest useful rollback
directories and remove older directories by their exact names. Then run:

```bash
docker image prune -f
```

Do not use `docker image prune -a` on this host.

## 5. Deployment files and access

Repository files install as follows:

| Repository | VPS |
| --- | --- |
| `deploy/compose.yaml` | `/srv/grampacker/compose.yaml` |
| `deploy/Caddyfile` | `/srv/grampacker/Caddyfile` |
| `deploy/grampacker-deploy` | `/usr/local/sbin/grampacker-deploy` |
| `deploy/grampacker-deploy-ssh` | `/usr/local/sbin/grampacker-deploy-ssh` |

The normal administrator account is `joe`, using SSH and sudo. The `deploy`
account has no password or Docker-group membership. Its only sudo command is:

```text
(root) NOPASSWD: /usr/local/sbin/grampacker-deploy-ssh
```

Its root-owned `authorized_keys` entry begins:

```text
restrict,command="/usr/local/sbin/grampacker-deploy-ssh" ssh-ed25519 ...
```

The forced command accepts exactly `deploy sha256:<64 lowercase hex>`. It
runs the deployment in a separate session and writes a private log under
`/var/log/grampacker-deploy/`, so losing the SSH connection does not interrupt
the deployment.

The GitHub `production` environment allows only `main` and holds:

- secret `DEPLOY_SSH_KEY`;
- variable `DEPLOY_HOST`;
- variable `DEPLOY_KNOWN_HOSTS`.

The GHCR package is linked to `joes703/grampacker`; the repository has Actions
write access. Root's `/root/.docker/config.json` holds a GitHub classic token
with only `read:packages`, mode `0600`.

## 6. Rebuild or replace the VPS

The repository can recreate the service, but it cannot recreate production
data or secrets. Before losing the old host, retain a consistent copy of the
SQLite data directory, the application environment values listed in section
1, the GHCR read-only credential and the VPS SSH host-key fingerprint. If no
database copy exists, the rebuilt service starts empty.

### 6.1 Prepare Ubuntu

Create an Ubuntu LTS host with a sudo administrator account. Install the
current Docker Engine and Compose plugin from Docker's official Ubuntu
repository. Also install `curl`, `openssh-server`, `sqlite3`, `ufw` and
`unattended-upgrades`.

Enable Docker and allow only SSH, HTTP and HTTPS from the internet:

```bash
# [VPS root]
systemctl enable --now docker ssh unattended-upgrades
ufw default deny incoming
ufw default allow outgoing
ufw limit OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Keep the current SSH session open until a second session succeeds. Do not
publish container port 3000 on a non-loopback address.

### 6.2 Create the filesystem

```bash
# [VPS root]
install -d -o root -g root -m 0755 /srv/grampacker
install -d -o root -g root -m 0700 /srv/grampacker/data
chown 10001:10001 /srv/grampacker/data
install -d -o root -g root -m 0755 /srv/grampacker/maintenance
install -d -o root -g root -m 0700 \
  /srv/grampacker/secrets \
  /srv/grampacker/rollback \
  /srv/grampacker/caddy \
  /srv/grampacker/caddy/data \
  /srv/grampacker/caddy/config
```

Copy the five files under `deploy/` to `/tmp`, compare their SHA-256 hashes
with a clean checkout of `main`, then install them:

```bash
# [VPS root]
install -o root -g root -m 0644 /tmp/compose.yaml /srv/grampacker/compose.yaml
install -o root -g root -m 0644 /tmp/Caddyfile /srv/grampacker/Caddyfile
install -o root -g root -m 0755 \
  /tmp/grampacker-deploy /tmp/grampacker-deploy-ssh /usr/local/sbin/
```

`Caddyfile.rehearsal` is used only when testing changes and need not be
installed in production.

### 6.3 Restore configuration and data

Write `deploy.env` and `secrets/app.env` with the names and modes in section
1. Use an exact image digest that was published by a successful main workflow
run. Do not use an image tag.

If `BETTER_AUTH_SECRET` cannot be recovered, generate 32 random bytes and
store their 64-character hexadecimal form. Existing sessions and outstanding
magic links will no longer work; passkeys and stored application data remain
usable. If the Resend key was lost, create a replacement restricted to the
required sender.

Restore the saved data directory before starting the app. The copy must have
been made while the app was stopped or by a SQLite-safe backup operation. It
may include `grampacker.db-wal` and `grampacker.db-shm`; restore the complete
set together. Then enforce ownership and permissions:

```bash
# [VPS root]
chown -R 10001:10001 /srv/grampacker/data
chmod 0700 /srv/grampacker/data
find /srv/grampacker/data -type f -exec chmod 0600 {} +
```

Log root into GHCR without putting the token on the command line:

```bash
# [VPS root]
read -rsp 'GHCR read-only token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u joes703 --password-stdin
unset GHCR_TOKEN
chmod 0600 /root/.docker/config.json
```

### 6.4 Recreate deployment access

Create the restricted account and sudo rule:

```bash
# [VPS root]
adduser --disabled-password --comment 'GitHub Actions deploy' --shell /bin/bash deploy
cat >/etc/sudoers.d/50-grampacker-deploy <<'RULE'
deploy ALL=(root) NOPASSWD: /usr/local/sbin/grampacker-deploy-ssh
RULE
chmod 0440 /etc/sudoers.d/50-grampacker-deploy
visudo -c
install -d -o root -g root -m 0755 /home/deploy /home/deploy/.ssh
```

Create a new Ed25519 deployment key on the admin workstation, without a
passphrase. Install its public key as one root-owned line in
`/home/deploy/.ssh/authorized_keys`:

```text
restrict,command="/usr/local/sbin/grampacker-deploy-ssh" ssh-ed25519 ...
```

Set the file to `root:root`, mode `0644`. Verify that a shell, PTY, port
forward and file copy are refused, while a valid digest reaches the wrapper.
Record the new host's Ed25519 fingerprint through a trusted console or an
already verified administrator connection.

Replace `DEPLOY_SSH_KEY`, `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS` in GitHub's
`production` environment, then delete the private deployment key from the
workstation.

### 6.5 Point DNS and start production

In Cloudflare DNS, keep the apex A record DNS-only and point it at the VPS.
Do not add an AAAA record unless the host is configured and firewalled for
IPv6. Keep the existing mail records.

Start with maintenance enabled, then start Caddy and deploy the chosen digest:

```bash
# [VPS root]
unset GRAMPACKER_ROOT
touch /srv/grampacker/maintenance/on
grampacker-deploy caddy-update
grampacker-deploy deploy sha256:<64 lowercase hex>
curl -fsS https://grampacker.app/api/health && echo
```

Confirm that the app is healthy, magic-link and passkey sign-in work, public
shares load, port 3000 listens only on `127.0.0.1`, and only SSH, HTTP and
HTTPS are publicly allowed. Finally run a GitHub deployment to prove the
restricted path works end to end.

## 7. Change or test deployment files

Changes under `deploy/` require an empty-database rehearsal before installing
them. Copy the pull request's versions, not `main`'s, into `/tmp` on the VPS.
Run the stack under `/srv/grampacker-rehearsal` with:

- `APP_PORT=3001`;
- `CADDYFILE=Caddyfile.rehearsal`;
- `SITE_URL=http://127.0.0.1:8081/`;
- a newly generated rehearsal-only auth secret;
- `GRAMPACKER_ROOT=/srv/grampacker-rehearsal`.

Prove deploy, maintenance across a Caddy restart and stopped app, failed
deploy behavior, rollback and refusal to roll back while maintenance is off.
Use `/tmp/grampacker-deploy`, the file under test, rather than the installed
production script. Tear the Compose project down, remove only the rehearsal
directory, and `unset GRAMPACKER_ROOT` before returning to production work.

After a successful rehearsal, compare SHA-256 hashes and install only the
changed deployment files using the mapping in section 5.

## 8. Troubleshooting

- Public `503`: maintenance is on. Find the failed or unfinished operation
  before turning it off.
- App container unhealthy: inspect `docker compose --env-file deploy.env
  logs app`; do not bypass the health check.
- Certificate failure: confirm DNS points to the VPS and TCP ports 80 and 443
  are open.
- GitHub says `Host key verification failed`: replace
  `DEPLOY_KNOWN_HOSTS` only after verifying the host key through a trusted
  path.
- GitHub says `Permission denied (publickey)`: compare the environment key
  with the root-owned forced-command entry.
- One machine has stale DNS while `dig @1.1.1.1 grampacker.app` is correct:
  reconnect Tailscale; see tailscale/tailscale#21816.

Keep these records outside Git, in the password manager or operations notes:

- VPS SSH host-key fingerprint;
- GHCR read-only token expiry;
- current deployed image digest and source commit;
- current Caddy version;
- last host patch and reboot date;
- location and date of the latest usable database copy.
