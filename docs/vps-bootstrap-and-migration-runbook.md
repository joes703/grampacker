# Grampacker VPS operations

Production is the Node/SQLite application on the VPS. The retired Cloudflare
Worker and D1 database were deleted on 2026-10-16. The migration procedure is
in Git history; this file contains only current operations.

## 0. Before production work

Commands marked `[admin]` run on an administrator workstation. Commands
marked `[VPS root]` run after `ssh grampacker-vps` and `sudo -i`.

In every new production root shell:

```bash
unset GRAMPACKER_ROOT
test -z "${GRAMPACKER_ROOT:-}" || { echo STOP; exit 1; }
cd /srv/grampacker
```

Wait for the app after a start or restart:

```bash
cd /srv/grampacker
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose --env-file deploy.env ps -q app)" 2>/dev/null)" = healthy ]; do
  sleep 2
done
curl -fsS http://127.0.0.1:3000/api/health && echo
```

Stop if the command would expose a secret, modify production SQLite outside
the deploy script, or use a tag where an app digest is required.

## 1. Production layout

| Item | Value |
| --- | --- |
| Public site | `https://grampacker.app` |
| VPS root | `/srv/grampacker` |
| App | exact `ghcr.io/joes703/grampacker@sha256:...` digest, bound to `127.0.0.1:3000` |
| Proxy | `caddy:2`, ports 80 and 443 |
| Database | `/srv/grampacker/data/grampacker.db` |
| App secrets | `/srv/grampacker/secrets/app.env`, `root:root`, mode `0600` |
| Deploy config | `/srv/grampacker/deploy.env`, `root:root`, mode `0644` |
| Rollbacks | `/srv/grampacker/rollback/<UTC stamp>/` |

`deploy.env` contains the running digest, ACME email and site URL. Do not
edit it while production runs. `app.env` contains `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM`. Never print it.

## 2. Host maintenance

Ubuntu unattended security updates stay enabled. Once a month:

```bash
# [VPS root]
apt-get update
apt list --upgradable
apt-get upgrade --with-new-pkgs
test ! -e /var/run/reboot-required || cat /var/run/reboot-required.pkgs
```

Docker package upgrades restart the containers briefly. Reboot at a quiet
time when requested, then wait for app health and verify the public health
endpoint.

## 3. Access

The normal administrator is `joe`, using SSH and sudo. Keep a second SSH
session open while changing sshd or sudo. The GitHub Actions account is
`deploy`; it has no password, no Docker access, and exactly one sudo command:

```text
(root) NOPASSWD: /usr/local/sbin/grampacker-deploy-ssh
```

Its authorized key is root-owned and begins:

```text
restrict,command="/usr/local/sbin/grampacker-deploy-ssh" ssh-ed25519 ...
```

## 4. Migration record

The VPS cutover completed on 2026-10-16. The imported users, passkeys, lists,
gear and food matched the former database row for row. Sessions,
verification records and rate-limit buckets were deliberately discarded.
The first GitHub-to-VPS deploy succeeded as Actions run `38957454976`.

The Worker, D1 database, their GitHub credentials and the old deployment
workflow were deleted after the VPS was verified. They are not rollback
targets.

## 5. GitHub production environment

Repository Settings → Environments → `production` must have the deployment
branch rule `main`. It holds:

- secret `DEPLOY_SSH_KEY`;
- variables `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`.

The GHCR package stays private, linked to `joes703/grampacker`, with this
repository granted Actions write access.

## 6. Images and GHCR

### 6.1 Publish without deploying

```bash
# [admin]
gh workflow run image.yml --repo joes703/grampacker --ref main
gh run list --repo joes703/grampacker --workflow image.yml \
  --event workflow_dispatch --limit 1 --json databaseId,headSha,status,url
gh run watch <RUN_ID> --repo joes703/grampacker --exit-status
gh run view <RUN_ID> --repo joes703/grampacker --log | \
  grep -E 'published |digest +sha256:|image +ghcr'
```

The run builds and tests `linux/amd64`, publishes the commit tag, and prints
the immutable digest. Deploy only that digest. If the tag already exists,
use it only when an earlier successful run for the same commit printed its
digest.

### 6.2 VPS pull credential

Root's `/root/.docker/config.json` holds a classic GitHub token with only
`read:packages`, mode `0600`. Renew it before expiry:

```bash
# [VPS root]
read -rsp 'GHCR read-only token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u joes703 --password-stdin
unset GHCR_TOKEN
chmod 0600 /root/.docker/config.json
```

## 7. Deployment files

Repository files install as follows:

| Repository | VPS |
| --- | --- |
| `deploy/compose.yaml` | `/srv/grampacker/compose.yaml` |
| `deploy/Caddyfile` | `/srv/grampacker/Caddyfile` |
| `deploy/grampacker-deploy` | `/usr/local/sbin/grampacker-deploy` |
| `deploy/grampacker-deploy-ssh` | `/usr/local/sbin/grampacker-deploy-ssh` |

Install changed files only after the rehearsal:

```bash
# [admin], clean main
cd ~/code/grampacker/deploy
shasum -a 256 compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy grampacker-deploy-ssh
scp compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy grampacker-deploy-ssh grampacker-vps:/tmp/
```

```bash
# [VPS root]
cd /tmp
sha256sum compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy grampacker-deploy-ssh
install -o root -g root -m 0755 grampacker-deploy grampacker-deploy-ssh /usr/local/sbin/
install -o root -g root -m 0644 compose.yaml Caddyfile /srv/grampacker/
```

The checksum lists must match.

### 7.4 Empty-database rehearsal

Run this for changes under `deploy/`. Use the pull request's files in `/tmp`,
not the installed production script.

```bash
# [VPS root]
R=/srv/grampacker-rehearsal
install -d -m 0755 "$R" "$R/maintenance"
install -d -m 0700 "$R/data" "$R/secrets" "$R/rollback" "$R/caddy" "$R/caddy/data" "$R/caddy/config"
chown 10001:10001 "$R/data"
install -m 0644 /tmp/compose.yaml /tmp/Caddyfile.rehearsal "$R/"
install -m 0755 /tmp/grampacker-deploy "$R/grampacker-deploy"
tee "$R/deploy.env" >/dev/null <<'EOF'
APP_IMAGE=ghcr.io/joes703/grampacker@<APP_DIGEST>
APP_PORT=3001
CADDYFILE=Caddyfile.rehearsal
SITE_URL=http://127.0.0.1:8081/
EOF
( umask 077; printf 'BETTER_AUTH_URL=https://grampacker.app\nBETTER_AUTH_SECRET=%s\n' "$(openssl rand -base64 32)" >"$R/secrets/app.env" )
touch "$R/maintenance/on"
export GRAMPACKER_ROOT="$R"
D="$R/grampacker-deploy"
"$D" caddy-update
"$D" deploy <APP_DIGEST>
curl -fsS http://127.0.0.1:8081/api/health && echo
```

Then prove maintenance survives a Caddy restart and an app stop; deploy the
same digest again; prove rollback refuses while maintenance is off; turn it
on, roll back the newest directory, and confirm health. Finally:

```bash
cd "$R" && docker compose --env-file deploy.env down
cd /
unset GRAMPACKER_ROOT R D
rm -rf /srv/grampacker-rehearsal
echo "GRAMPACKER_ROOT=${GRAMPACKER_ROOT:-unset}"
```

Expected: `GRAMPACKER_ROOT=unset` and no rehearsal containers or directory.

## 8. GitHub-to-VPS key

The SSH key's forced command accepts only
`deploy sha256:<64 lowercase hex>`. The wrapper validates it again as root,
runs the deploy script in its own session, and logs under
`/var/log/grampacker-deploy/`.

### 8.4 Verify the limits

When rotating the key, verify that a shell, maintenance command, tag, PTY,
port forward and file copy all fail. Space attempts by ten seconds so UFW's
SSH rate limit does not hide the result. An all-zero digest must reach the
wrapper, fail its image pull, and leave maintenance and data untouched.

### 8.7 Rotate or remove

To rotate: create a new Ed25519 key without a passphrase, replace the
root-owned authorized-key line, run 8.4, replace `DEPLOY_SSH_KEY` in the
production environment, then delete both local key files.

To remove GitHub deployment completely, first delete its environment secret
and variables, then remove `/etc/sudoers.d/50-grampacker-deploy`, validate
sudo, kill the account's processes, and `deluser --remove-home deploy`.

## 9. Routine operations

### 9.1 Deploy

```bash
# [admin]
gh workflow run image.yml --repo joes703/grampacker --ref main -f deploy=true
gh run list --repo joes703/grampacker --workflow image.yml \
  --event workflow_dispatch --limit 1 --json databaseId,headSha,url
gh run watch <RUN_ID> --repo joes703/grampacker --exit-status
curl -fsS https://grampacker.app/api/health && echo
```

The script locks deployments, pulls the digest, enables maintenance, stops
the app, copies the complete data directory and previous digest into a new
rollback directory, migrates, starts and health-checks the new image, then
reopens the site.

Manual recovery uses the same script:

```bash
ssh -t grampacker-vps 'sudo /usr/local/sbin/grampacker-deploy deploy <APP_DIGEST>'
```

### 9.2 Failed deploy

Maintenance stays on and the log names the rollback directory. If one was
created:

```bash
# [VPS root]
grampacker-deploy rollback /srv/grampacker/rollback/<stamp>
grampacker-deploy maintenance off
```

If failure occurred before the copy, data is untouched. Restart the prior
app, wait for health, then turn maintenance off.

### 9.3 Rollback after reopening

This discards live writes since the deployment, although the discarded data
is retained under `failed-data-<time>`. Record what is broken, what writes can
be lost, and why fix-forward is not suitable. Then:

```bash
# [VPS root]
grampacker-deploy maintenance on
grampacker-deploy rollback /srv/grampacker/rollback/<stamp>
```

The script refuses this rollback unless maintenance is on.

### 9.4 Caddy update

```bash
# [VPS root]
grampacker-deploy caddy-update
```

It pulls `caddy:2`, validates the Caddyfile with the new image, recreates only
Caddy and checks the response. Run monthly and promptly after a Caddy security
release.

### 9.5 Cleanup

Rollback directories and unused images are not automatic. After a deployment
has been healthy long enough, keep the newest few rollback directories and
remove older named directories. Then `docker image prune -f`. Never use
`docker image prune -a` here.

### 9.6 Patch cadence

- Security fixes: deploy or update as soon as practical, the same day when
  possible.
- Other merged runtime dependency or base-image changes: deploy within seven
  days.
- Host packages and Caddy: check monthly.

A rebuilt unchanged commit does not acquire pinned dependency or base-image
updates. The relevant lockfile or Dockerfile digest must move first.

### 9.7 Troubleshooting

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env ps
docker compose --env-file deploy.env logs --since 1h app
docker compose --env-file deploy.env logs --since 1h caddy
```

- Public `503`: maintenance is on; find out why before turning it off.
- One machine has stale DNS while `dig @1.1.1.1` is correct: reconnect
  Tailscale (tailscale/tailscale#21816).
- Certificate error: DNS must point to the VPS and ports 80/443 must be open.
- Deploy `Host key verification failed`: fix `DEPLOY_KNOWN_HOSTS`.
- Deploy `Permission denied (publickey)`: check the production key and the
  root-owned authorized-key line.

## 10. Records

Keep these outside Git, in the password manager or operations notes:

- VPS SSH host-key fingerprint;
- GHCR read-only token expiry;
- current Caddy version;
- last host patch and reboot date;
- current deployed image digest and source commit.
