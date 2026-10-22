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

If the script prints `DEPLOY FAILED`, its report says whether maintenance is
on and whether it created a rollback directory. A pull or initial maintenance
failure happens before that report and before the app or data changes; inspect
the command error and current maintenance state. If a failure report says the
maintenance file was already removed, put the site back into maintenance
before attempting a rollback:

```bash
# [VPS root]
grampacker-deploy maintenance on
```

If a rollback directory was created:

```bash
# [VPS root]
grampacker-deploy rollback /srv/grampacker/rollback/<timestamp>
# Check the app before reopening it.
grampacker-deploy maintenance off
```

If it failed before copying data, the data directory is unchanged. Restart
the prior app, wait for health, then turn maintenance off.

The first deployment on a rebuilt host has no previous image, so its rollback
directory cannot be used to roll back. Keep maintenance on and fix forward.

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

Once a month, compare the Dockerfile's exact Node tag and digest with the
current `node:24-trixie-slim` image using the commands in
`docs/container-image.md`. If either moved, update both in a reviewed pull
request and deploy the resulting image.

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

SSH reaches the VPS only over the tailnet: the provider (RackNerd) edge
firewall blocks public port 22, and `DEPLOY_HOST` is the VPS's tailnet IPv4
address. sshd itself still runs; Tailscale SSH stays off, because it would
intercept tailnet port 22 before OpenSSH and the forced command below would
no longer apply. GitHub Actions joins the tailnet for the deploy job as an
ephemeral node tagged `tag:ci`, which the tailnet policy allows to reach
only the VPS on port 22 (section 6.4).

The normal administrator account is `joe`, using SSH over the tailnet and
sudo. The `deploy` account has no password or Docker-group membership. Its
only sudo command is:

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
- secret `TS_OAUTH_CLIENT_ID` and secret `TS_OAUTH_SECRET` — a Tailscale
  OAuth client with only the `auth_keys` write scope, restricted to
  `tag:ci`;
- variable `DEPLOY_HOST` — the VPS's tailnet IPv4 address;
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
repository. Also install `curl`, `openssh-server`, `sqlite3`, `ufw`,
`unattended-upgrades`, and Tailscale from its official repository.

Join the tailnet and confirm Tailscale SSH is off; if it were on, it would
intercept tailnet port 22 before OpenSSH, and the deploy account's forced
command (section 6.4) would no longer apply:

```bash
# [VPS root]
tailscale up
tailscale ip -4
tailscale debug prefs | grep RunSSH
```

Expected: `"RunSSH": false`. The IPv4 address (`100.x.y.z`) is the host
string every later step and GitHub Actions use; it is stable for the life of
the tailnet node.

SSH is never opened to the internet. While the provider-console session is
still available, prove a key-authenticated administrator session works over
the tailnet address, then block port 22 in the provider's edge firewall.
Also disable root, password and keyboard-interactive login:

```bash
# [VPS root]
cat >/etc/ssh/sshd_config.d/10-grampacker-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t
systemctl reload ssh
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '
```

Expected: all three settings are `no`. Fix any other result before enabling
the firewall. Then enable Docker and allow only HTTP and HTTPS from the
internet. The OpenSSH rule stays as a second layer in case the provider
firewall rule is ever removed; tailnet traffic arrives on `tailscale0`,
which Tailscale's own netfilter rules accept ahead of UFW:

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

Copy `compose.yaml`, `Caddyfile`, `Caddyfile.rehearsal`,
`grampacker-deploy` and `grampacker-deploy-ssh` from `deploy/` to `/tmp` and
compare their SHA-256 hashes with a clean checkout of `main`. Install the four
production files:

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
chown -R root:root /home/deploy
```

The home directory and its existing startup files are root-owned so the
restricted account cannot alter what its forced command runs.

On the admin workstation, set `VPS_HOST` to the VPS's tailnet IPv4 address
(`tailscale ip -4` on the VPS) — the exact host string GitHub Actions will
use. Create a new Ed25519 deployment key without a passphrase and copy its
public half through the administrator account:

```bash
# [admin]
( umask 077; ssh-keygen -t ed25519 -N '' \
  -C "grampacker-github-deploy-$(date -u +%F)" \
  -f ~/grampacker-deploy-key )
ssh-keygen -lf ~/grampacker-deploy-key.pub
scp ~/grampacker-deploy-key.pub joe@"$VPS_HOST":/tmp/grampacker-deploy-key.pub
```

Install it as one root-owned forced-command entry:

```bash
# [VPS root]
printf 'restrict,command="/usr/local/sbin/grampacker-deploy-ssh" %s\n' \
  "$(cat /tmp/grampacker-deploy-key.pub)" >/home/deploy/.ssh/authorized_keys
chown root:root /home/deploy/.ssh/authorized_keys
chmod 0644 /home/deploy/.ssh/authorized_keys
rm /tmp/grampacker-deploy-key.pub
ssh-keygen -lf /home/deploy/.ssh/authorized_keys
```

Verify that a shell, maintenance command, image tag, PTY, port forward and
file copy are refused. These tests run over the tailnet, where UFW's SSH
rate limit does not apply (tailnet traffic bypasses UFW), so the ten-second
spacing matters only if testing a public address. The all-zero digest
reaches the wrapper but cannot pull an image, so it stops before maintenance
or data are changed:

```bash
# [admin]
K=(-i ~/grampacker-deploy-key -o IdentitiesOnly=yes -o BatchMode=yes)
ssh "${K[@]}" deploy@"$VPS_HOST"; echo "exit=$?"; sleep 10
ssh "${K[@]}" deploy@"$VPS_HOST" 'maintenance off'; echo "exit=$?"; sleep 10
ssh "${K[@]}" deploy@"$VPS_HOST" 'deploy ghcr.io/joes703/grampacker:latest'; echo "exit=$?"; sleep 10
ssh "${K[@]}" -tt deploy@"$VPS_HOST" 'id'; echo "exit=$?"; sleep 10
ssh "${K[@]}" -o ExitOnForwardFailure=yes \
  -R 127.0.0.1:18099:127.0.0.1:22 deploy@"$VPS_HOST" 'id'; echo "exit=$?"; sleep 10
scp "${K[@]}" ~/grampacker-deploy-key.pub \
  deploy@"$VPS_HOST":/tmp/deploy-wrote-this; echo "exit=$?"; sleep 10
ssh "${K[@]}" deploy@"$VPS_HOST" \
  "deploy sha256:$(printf '0%.0s' {1..64})"; echo "exit=$?"
```

Expected: the first three are refused with exit 2; PTY, forwarding and file
copy fail with exit 255; `/tmp/deploy-wrote-this` does not exist; and the
all-zero digest reaches `grampacker-deploy-ssh` but fails its image pull with
exit 1. A timeout means the request never reached sshd; check the tailnet
path (`tailscale status` on both ends) before repeating the checks.

Next, grant GitHub Actions a path onto the tailnet. The tailnet policy uses
grants syntax, and the VPS is the tagged device `tag:grampacker-vps`, so the
CI grant names the tag and keeps working if the VPS's tailnet IP ever
changes. In the Tailscale admin console, add `tag:ci` to `tagOwners` and
grant it TCP port 22 to the VPS tag only. Grants are additive — any other
grant whose `src` also matches `tag:ci` (or `*`) would widen CI's reach — so
check the rest of the policy before saving. Keep a `tests` block so the
policy editor itself refuses a regression (these tests use literal IPs, so
update them if the VPS's IP changes):

```jsonc
"tagOwners": {
  "tag:grampacker-vps": [], // the VPS; empty list: only admins manage it
  "tag:ci": [],             // GitHub Actions deploy runners
},
"grants": [
  // ...the tailnet's own grants stay as they are...
  // CI reaches only the VPS's sshd.
  {"src": ["tag:ci"], "dst": ["tag:grampacker-vps"], "ip": ["tcp:22"]},
],
"tests": [
  {
    "src": "tag:ci",
    "accept": ["<VPS tailnet IP>:22"],
    "deny": ["<VPS tailnet IP>:443", "<another device's tailnet IP>:22"],
  },
],
```

Then, under Settings → OAuth clients, generate a client with only the
`auth_keys` write scope, restricted to tag `tag:ci`, and record its ID and
secret. The deploy job uses it to mint an ephemeral, preauthorized node per
run; the action logs the node out when the job ends. Anyone holding the
secret can mint `tag:ci` nodes — persistent ones too, since ephemerality is
the client's choice — bounded by the ACL above. If it leaks: revoke the
OAuth client in the admin console and delete any unexpected `tag:ci` nodes
from the Machines page.

Read the host's full Ed25519 public key through the already verified
administrator connection. The displayed fingerprint must match the value
recorded through the provider console. Store the full key with exactly the
same host string as `DEPLOY_HOST`:

```bash
# [admin]
GH_REPO=joes703/grampacker
HOSTKEY="$(ssh joe@"$VPS_HOST" cat /etc/ssh/ssh_host_ed25519_key.pub | cut -d' ' -f1,2)"
printf '%s %s\n' "$VPS_HOST" "$HOSTKEY" | ssh-keygen -lf -
gh secret set DEPLOY_SSH_KEY --repo "$GH_REPO" --env production \
  <~/grampacker-deploy-key
# Each prompts for its value: paste it, press Enter, then Ctrl-D.
gh secret set TS_OAUTH_CLIENT_ID --repo "$GH_REPO" --env production
gh secret set TS_OAUTH_SECRET --repo "$GH_REPO" --env production
gh variable set DEPLOY_HOST --repo "$GH_REPO" --env production \
  --body "$VPS_HOST"
gh variable set DEPLOY_KNOWN_HOSTS --repo "$GH_REPO" --env production \
  --body "$VPS_HOST $HOSTKEY"
gh secret list --repo "$GH_REPO" --env production
gh variable list --repo "$GH_REPO" --env production
rm -f ~/grampacker-deploy-key ~/grampacker-deploy-key.pub
```

`DEPLOY_KNOWN_HOSTS` is one known-hosts line: `<DEPLOY_HOST> ssh-ed25519
<public key>`, not a fingerprint.

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
shares load, port 3000 listens only on `127.0.0.1`, and only HTTP and HTTPS
are publicly reachable (port 22 answers only on the tailnet). Finally run a
GitHub deployment to prove the restricted path works end to end.

## 7. Change or test deployment files

Changes under `deploy/` require an empty-database rehearsal before installing
them. Copy the pull request's versions, not `main`'s, into `/tmp` on the VPS.
Use an exact published image digest and the script under test:

```bash
# [VPS root]
R=/srv/grampacker-rehearsal
[ ! -e "$R" ] || { echo "ERROR: $R already exists" >&2; exit 1; }
install -d -m 0755 "$R" "$R/maintenance"
install -d -m 0700 "$R/data" "$R/secrets" "$R/rollback" \
  "$R/caddy" "$R/caddy/data" "$R/caddy/config"
chown 10001:10001 "$R/data"
install -m 0644 /tmp/compose.yaml /tmp/Caddyfile.rehearsal "$R/"
install -m 0755 /tmp/grampacker-deploy "$R/grampacker-deploy"
tee "$R/deploy.env" >/dev/null <<'EOF'
APP_IMAGE=ghcr.io/joes703/grampacker@<APP_DIGEST>
APP_PORT=3001
CADDYFILE=Caddyfile.rehearsal
SITE_URL=http://127.0.0.1:8081/
EOF
( umask 077
  printf 'BETTER_AUTH_URL=https://grampacker.app\nBETTER_AUTH_SECRET=%s\n' \
    "$(openssl rand -base64 32)" >"$R/secrets/app.env" )
touch "$R/maintenance/on"
export GRAMPACKER_ROOT="$R"
D="$R/grampacker-deploy"
"$D" caddy-update
"$D" deploy <APP_DIGEST>
curl -fsS http://127.0.0.1:8081/api/health && echo
```

Prove maintenance survives both a Caddy restart and a stopped app:

```bash
# [VPS root] same shell
cd "$R"
docker compose --env-file deploy.env restart app caddy
sleep 30
curl -fsS http://127.0.0.1:8081/api/health && echo
"$D" maintenance on
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/api/categories
docker compose --env-file deploy.env restart caddy
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/
docker compose --env-file deploy.env stop app
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/lists/x
docker compose --env-file deploy.env start app
sleep 30
"$D" maintenance off
```

Expected: health succeeds, then the three maintenance requests return `503`.
Deploy the same digest again so the rollback point has a previous image, prove
rollback is refused while maintenance is off, then perform it:

```bash
# [VPS root] same shell
"$D" deploy <APP_DIGEST>
LATEST="$(find "$R/rollback" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)"
cat "$R/rollback/$LATEST/previous-image"
"$D" rollback "$R/rollback/$LATEST"
"$D" maintenance on
"$D" rollback "$R/rollback/$LATEST"
"$D" maintenance off
curl -fsS http://127.0.0.1:8081/api/health && echo
```

The first rollback must say to turn maintenance on. The second must keep the
site in maintenance until the explicit `maintenance off`. Tear down and clear
the override before any production command:

```bash
# [VPS root] same shell
cd "$R" && docker compose --env-file deploy.env down
cd /
unset GRAMPACKER_ROOT R D LATEST
rm -rf /srv/grampacker-rehearsal
echo "GRAMPACKER_ROOT=${GRAMPACKER_ROOT:-unset}"
docker ps -a --filter label=com.docker.compose.project=grampacker-rehearsal
test ! -e /srv/grampacker-rehearsal && echo "rehearsal directory removed"
```

Expected: `GRAMPACKER_ROOT=unset`, no rehearsal containers and no rehearsal
directory.

After a successful rehearsal, compare SHA-256 hashes and install only the
changed deployment files using the mapping in section 5.

## 8. Troubleshooting

- Public `503`: maintenance is on. Find the failed or unfinished operation
  before turning it off.
- App container unhealthy: inspect `docker compose --env-file deploy.env
  logs app`; do not bypass the health check.
- Certificate failure: confirm DNS points to the VPS and TCP ports 80 and 443
  are open.
- Deploy job fails with ssh exit 255 after about 30 seconds, or the "Join
  the tailnet" step times out: the runner never reached sshd over the
  tailnet. Check that step's log first, then the ACL (`tag:ci` must reach
  the VPS on 22), the OAuth client (not revoked, `auth_keys` write scope,
  tag `tag:ci`), that `DEPLOY_HOST` is still the VPS's tailnet IP, and that
  `tailscaled` is running on the VPS.
- GitHub says `Host key verification failed`: replace
  `DEPLOY_KNOWN_HOSTS` only after verifying the host key through a trusted
  path.
- GitHub says `Permission denied (publickey)`: compare the environment key
  with the root-owned forced-command entry.
- One machine has stale DNS while `dig @1.1.1.1 grampacker.app` is correct:
  reconnect Tailscale; see tailscale/tailscale#21816.

Keep these records outside Git, in the password manager or operations notes:

- VPS SSH host-key fingerprint;
- the Tailscale OAuth client's ID and where its secret is stored;
- GHCR read-only token expiry;
- current deployed image digest and source commit;
- current Caddy version;
- last host patch and reboot date;
- location and date of the latest usable database copy.
