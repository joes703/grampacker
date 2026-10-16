# Grampacker VPS operations runbook

**Status:** Production has run on the VPS since 2026-10-16. This runbook is
for operating it: deploying, maintaining, rolling back and troubleshooting.
The one-time setup, the rehearsals and the move from Cloudflare Workers and
D1 are done; section 4 records them. The old Worker and D1 remain, unchanged
and serving no traffic, as rollback targets until they are decommissioned
(12.3); 11.2 is the procedure for returning to them.

The file keeps its old name, and its section numbers are kept, because code
comments and other documents cite them. `docs/vps-migration-plan.md` is the
dated record of why the move was made.

## 0. How to use this runbook

### Where a command runs

Every command block starts with a location tag. Run it only there.

| Tag | Meaning |
| --- | --- |
| `[admin workstation]` | Terminal on walnut or the Mac, either one |
| `[walnut]` | Terminal on walnut: the step needs its `wrangler login` |
| `[Mac]` | Terminal on the Mac |
| `[RackNerd console]` | The provider's VNC/serial console in the RackNerd control panel. Works when SSH does not. |
| `[VPS joe]` | SSH session on the VPS as `joe`, ordinary shell |
| `[VPS root]` | Root shell on the VPS, opened from `[VPS joe]` with `sudo -i` |
| `[GitHub web]` | github.com settings pages |
| `[GitHub Actions]` | A workflow run (you start it or watch it; you do not type these commands) |
| `[GHCR]` | GitHub Container Registry, through github.com package pages |
| `[Cloudflare]` | Cloudflare dashboard, or `wrangler` on walnut where noted |
| `[sandbox]` | The coding agent's sandbox |

A step marked **CONFIRM** changes DNS, a Worker route, D1, production data or
a GitHub security setting. Run it only after you have said "yes" to that
exact step. Approval of one CONFIRM step does not approve the next one.

### Names used in commands

Set these at the top of a shell. The address appears literally only here;
commands use `$VPS_HOST`.

```bash
# [admin workstation]
VPS_HOST=104.168.43.9          # current RackNerd address; change only this line after a move
GH_REPO=joes703/grampacker
IMAGE_REPO=ghcr.io/joes703/grampacker
```

Placeholders that you replace when you run a command:

| Placeholder | Meaning |
| --- | --- |
| `<APP_DIGEST>` | A Grampacker image digest, `sha256:` plus 64 hex characters, as the Image workflow prints it (6.1) |
| `<APP_SHA>` | The full 40-character commit SHA an image was built from; its GHCR tag |
| `<RUN_ID>` | A GitHub Actions run id: `databaseId` in `gh run list --json` |
| `<STAMP>` | A rollback directory's name, or a UTC time such as `20261101T1530Z` |
| `<WORKERS_SUBDOMAIN>` | The account's `workers.dev` subdomain, shown in the Cloudflare dashboard |

**Secret values never appear in this file.** Where a secret is needed, the
command reads it from the keyboard with `read -rs` (not saved in shell
history, not shown on screen).

### Production root shells

`grampacker-deploy` works on `/srv/grampacker`, or on `GRAMPACKER_ROOT` when
that variable is set. Only the empty-database rehearsal (7.4) sets it. Run
production commands in a new root shell, and check first:

```bash
# [VPS root]
unset GRAMPACKER_ROOT
echo "GRAMPACKER_ROOT=${GRAMPACKER_ROOT:-unset}"
```

Expected: `GRAMPACKER_ROOT=unset`. A shell that still has it set sends every
`grampacker-deploy` command to the rehearsal directory, and the production
checks that follow then test the wrong thing.

### Wait for the app to be healthy

After anything that starts or restarts the app container outside
`grampacker-deploy` (which waits by itself), wait for Docker's health check
before any HTTP check. An HTTP check made while the app is still starting
fails for no real reason.

```bash
# [VPS root]
cd /srv/grampacker
APP="$(docker compose --env-file deploy.env ps -q app)"
for i in $(seq 60); do
  STATE="$(docker inspect -f '{{.State.Health.Status}}' "$APP")"
  [ "$STATE" = healthy ] && break
  sleep 2
done
echo "app: $STATE"
```

Expected: `app: healthy` within two minutes. For the rehearsal (7.4), run it
with `cd "$R"` in place of `cd /srv/grampacker`.

### Stop rules

- If a command's output differs from "Expected", stop. Do not continue to the
  next step until the difference is understood.
- Never delete the D1 database. Deleting it is a separate, later decision
  (12.3).

## 1. Production as it runs

| Item | State |
| --- | --- |
| VPS | RackNerd KVM, Ubuntu 26.04.1 LTS, x86-64, 1.9 GiB RAM, 1 GiB swap, no global IPv6 address |
| Docker | Docker Engine, containerd and Compose from Docker's apt repository |
| Login | `joe`, key login from the Mac and walnut; root SSH login, password and keyboard-interactive login off |
| Firewall | UFW: deny incoming, allow outgoing, SSH rate-limited, TCP 80 and 443 allowed, no UDP 443 |
| Application | `ghcr.io/joes703/grampacker@sha256:453b52ee9d2976efce708906536d78062cf50459da3ef0127398754bde4a5c49` (since 2026-10-16), on `127.0.0.1:3000` only, as UID/GID 10001 |
| Database | `/srv/grampacker/data/grampacker.db`, `data/` owned by 10001, mode 0700 |
| Secrets | `/srv/grampacker/secrets/app.env`, `root:root`, mode 0600 |
| HTTPS | Caddy (`caddy:2`, host networking), certificate from Let's Encrypt |
| DNS | Cloudflare DNS, an A record for `grampacker.app` to the VPS, DNS only (not proxied); no AAAA record. The Worker's custom domain is removed. |
| Deploys | `image.yml` dispatched with `deploy` set (9.1), through the `deploy` account's forced command (section 8); or by hand as root |
| Rollback targets | Each deploy's rollback directory (9.2, 9.3); and, until decommissioned, the old Worker and D1 (11.2) |

### 1.1 Re-verify the host

Read-only and safe to rerun.

```bash
# [admin workstation]
ssh joe@"$VPS_HOST" 'uname -srm; . /etc/os-release; echo "$PRETTY_NAME"; free -h; df -h /'
ssh joe@"$VPS_HOST" 'docker --version; docker compose version; systemctl is-active docker'
ssh joe@"$VPS_HOST" 'ip -6 addr show scope global'
ssh -t joe@"$VPS_HOST" 'sudo sshd -T | grep -E "^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) "'
ssh -t joe@"$VPS_HOST" 'sudo ufw status verbose'
ssh -t joe@"$VPS_HOST" 'sudo ss -tulpn'
ssh -t joe@"$VPS_HOST" 'sudo stat -c "%U:%G %a %n" /srv/grampacker /srv/grampacker/data /srv/grampacker/secrets/app.env'
curl -sS -m 10 -o /dev/null -w '%{http_code}\n' https://grampacker.<WORKERS_SUBDOMAIN>.workers.dev/api/health
```

Expected:

- Ubuntu 26.04.1 LTS, `x86_64`, Docker `active`.
- `ip -6 addr show scope global` prints nothing.
- `permitrootlogin no`, `passwordauthentication no`,
  `kbdinteractiveauthentication no`.
- UFW `Status: active`, `Default: deny (incoming), allow (outgoing)`, rules for
  `22/tcp LIMIT`, `80/tcp ALLOW`, `443/tcp ALLOW` (and their `(v6)` copies),
  and no UDP 443 rule.
- `ss`: on a public address, only SSH and Caddy's TCP 80 and 443. The app on
  `127.0.0.1:3000`, and other local-only listeners such as `127.0.0.53`
  (systemd-resolved), are fine.
- `joe:joe 755 /srv/grampacker`, `10001:10001 700` for `data` (shown as
  numbers or as `UNKNOWN`: the host has no account 10001), and
  `root:root 600` for `app.env`.
- The `workers.dev` request fails or returns a Cloudflare error, never
  `200`. A `200` means the old Worker can still write to D1 there: turn its
  `workers.dev` route off (`[Cloudflare]` Workers & Pages, `grampacker`,
  Settings, Domains & Routes; CONFIRM).

If any line differs, stop and find out why.

### 1.2 SSH host key fingerprint

GitHub Actions pins this key for the deploy job (section 8). Section 13
records it. To check it again, read it from the console, which does not
depend on the network path, and compare it with what the admin workstation
trusts:

```bash
# [RackNerd console] logged in as joe
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

```bash
# [admin workstation]
ssh-keygen -lF "$VPS_HOST"
```

Expected: both print the fingerprint in section 13. If they differ, stop:
the workstation may be talking to a different machine.

## 2. Access and credentials

There are four kinds of access. Keep them separate. Never reuse a key from one
row for another.

| # | Credential | Where the secret lives | Logs in as / used by | Allowed to |
| --- | --- | --- | --- | --- |
| 1 | Administrator SSH keys | the Mac and walnut | `joe` | everything, through `sudo` |
| 2 | Temporary provisioning key | the agent sandbox, only while approved; none exists | `provision` (temporary account) | what that session needs; removed afterward |
| 3 | Deployment SSH key | GitHub: `production` environment secret | `deploy` | run the deploy wrapper with one image digest; nothing else (section 8) |
| 4 | Read-only GHCR credential | `/root/.docker/config.json` on the VPS | Docker (as root) | pull Grampacker images; cannot push or delete (6.2, 6.3) |

### 2.1 Administrator keys

`joe` logs in from the Mac and walnut with key authentication. Recovery when
SSH is lost (wrong firewall rule, broken `sshd_config`): the RackNerd console
still works, because it is a virtual screen and keyboard, not SSH.

Before any change to `sshd` or UFW, keep a second SSH session open, and test
the change from a new session before closing the old one.

```bash
# [Mac] and again from [walnut]
ssh -o PasswordAuthentication=no -o BatchMode=yes joe@"$VPS_HOST" true && echo OK
```

Expected: `OK` from both machines.

### 2.2 Temporary sandbox provisioning key (only if needed)

The coding sandbox does not need VPS access. If direct sandbox access is ever
needed, use only this process.

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
   also needs your approval in the sandbox network policy.

2. `[VPS root]` Create a separate temporary account and install the key.
   Paste the `.pub` line where shown; it is a public key, not a secret.

   ```bash
   # [VPS root]
   adduser --disabled-password --comment 'temporary provisioning' provision
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

## 3. VPS host maintenance

The containers bring their own operating system files, so apt on the host
never updates the app or Caddy; their images do (9.6). The host's updates
cover the kernel, Docker and everything else installed on the VPS:

| Packages | Updated by |
| --- | --- |
| Ubuntu's own packages, including the kernel | `unattended-upgrades`, daily, from Ubuntu's security pocket |
| Docker Engine, containerd, runc and Compose from Docker's apt repository (`docker-ce`, `containerd.io` (it includes runc), `docker-compose-plugin`) | By hand: the monthly check (9.6), and promptly after a Docker, containerd or runc security release |
| Any other apt repository | By hand, the monthly check |

By default `unattended-upgrades` installs only from Ubuntu's archive, never
from other repositories. Docker stays manual on purpose: an upgrade restarts
the Docker daemon and both containers, and nothing coordinates that with
`grampacker-deploy`. Check:

```bash
# [VPS joe]
systemctl is-enabled unattended-upgrades
cat /etc/apt/apt.conf.d/20auto-upgrades
apt-cache policy docker-ce containerd.io docker-compose-plugin docker.io
sudo unattended-upgrade --dry-run
```

Expected:

- `enabled`, and both `APT::Periodic` lines set to `"1"`. If not:
  `sudo dpkg-reconfigure -plow unattended-upgrades`, answer Yes, and check
  again.
- Docker's packages show `download.docker.com` as their source.
- The dry run ends without an error.

**Reboots:** a kernel or C library update takes effect only after a reboot.
Ubuntu creates `/var/run/reboot-required` when one is needed, and the login
message says `*** System restart required ***`. Automatic reboots stay off,
so a person sees the VPS come back:

```bash
# [VPS joe]
cat /var/run/reboot-required.pkgs
```

`No such file` means no reboot is needed. If it lists packages, reboot within
seven days, and sooner for a kernel security fix (`sudo reboot`). Both
containers restart by themselves (`restart: unless-stopped`). Afterward, in a
production root shell (section 0), wait for the app to be healthy (section
0), then:

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env ps
curl -sS -w ' %{http_code}\n' https://grampacker.app/api/health
```

Expected: both services running, and `{"ok":true} 200`.

`sqlite3` is installed on the host for integrity checks of rollback copies
(12.2).

## 4. Migration record (done)

A short record of the one-time work. The full procedures are in Git history
(this file at `46aa1b8`).

**Base setup (before 2026-10-11).** The VPS, `joe`, SSH hardening, UFW and
Docker from Docker's apt repository, as in section 1. The repository's
complete Git history was reviewed for secrets and data before it was made
public (5.1).

**Preparation (2026-10-15).** Versions after the VPS was updated and
rebooted:

| Component | Version |
| --- | --- |
| Ubuntu, kernel | 26.04.1 LTS, `7.0.0-31-generic` |
| Docker Engine, Compose, containerd | 29.9.1, 5.6.0, 2.4.2 |
| Caddy (`caddy:2`) | 2.11.7 |
| SQLite: host `sqlite3`, and inside the app image (`better-sqlite3`) | 3.46.1, 3.53.4 |

- A Docker port published on `127.0.0.1` was proved not public (`docker
  port`, `docker inspect`, `ss`, and a refused connection from outside).
  Docker's own packet-filter rules run before UFW's, so a port published
  without `127.0.0.1:` would be public whatever UFW says.
- Unattended security updates were enabled.
- The image runs as UID/GID 10001; the deployment files were installed.
- The empty-database rehearsal (7.4) passed: first deploy, restarts,
  maintenance and rollback.
- The VPS's ED25519 host key fingerprint was recorded (section 13).

**Worker deployment stopped.** `deploy.yml` was made legacy (every job
`if: false`) before the Node/SQLite code reached `main`.

**GitHub-to-VPS deployment (2026-10-15/16).** The `production` environment,
the `deploy` account, its sudo rule and its key were set up (sections 5 and
8), and a test run reached the VPS's forced command.

**Import rehearsal (2026-10-16).** On the real D1 data, with image
`sha256:e36ab22844e9dece0e4b60f6e973b919bcc61a4e00102ffbb81f230d5fca518f`:
the export took about 8 seconds and the import about 17; every importer
check passed; the imported app served the data; the per-account summaries
of D1 and SQLite matched exactly.

**Cutover (2026-10-16), completed successfully.**

- D1 writes were frozen by removing the Worker's custom domain, then D1 was
  exported and counted on walnut.
- The import's checks passed: schema, migration ledger, row counts, foreign
  keys, integrity, and every kept row compared value by value. Sessions,
  verification rows and rate-limit buckets were not imported.
- `BETTER_AUTH_SECRET` was rotated on purpose: there was no copy of the
  Worker's, and Cloudflare cannot show it. Everyone signs in again once;
  passkeys keep working, because their public keys were imported and the
  RP ID and origin stayed `grampacker.app`.
- DNS was pointed directly at the VPS (an A record, DNS only). Caddy
  obtained the certificate.
- Health, existing data, public shares, passkey sign-in and magic-link
  sign-in all passed on `https://grampacker.app`.
- The final deployment, GitHub Actions run 38957454976, succeeded through the build, the image checks, GHCR publication and the
  forced-SSH deployment. Production runs
  `ghcr.io/joes703/grampacker@sha256:453b52ee9d2976efce708906536d78062cf50459da3ef0127398754bde4a5c49`.
- Clean-up: the plaintext rehearsal and cutover exports were deleted from
  walnut and the VPS; the temporary deployment files and the rehearsal
  directory were removed. `secrets/app.env` is `root:root`, mode 0600.

**Lessons, now built into this runbook:**

- Unset `GRAMPACKER_ROOT` after rehearsal work and before production
  commands (section 0).
- Wait for Docker's health check before HTTP checks: a check made while
  the app is still starting fails for no real reason (section 0).
- Public-share slugs need not be typed, prompted for or printed: the
  importer's row-by-row comparison already proved the imported content.
- `wrangler d1 export` prints a signed download URL and, by default, also
  writes it to Wrangler's log file on disk: every export runs with
  `WRANGLER_WRITE_LOGS=false` (10.2).
- Ubuntu's `adduser` may put a new account in the `users` group (8.2).
- With PTY allocation disabled, `ssh -tt` may fail before the forced
  command runs (8.4). That is a secure result.
- After the DNS change, Tailscale on an admin machine kept a stale "no
  such name" answer for `grampacker.app` until Tailscale was reconnected
  (9.7; reported as tailscale/tailscale#21816).

## 5. GitHub settings for the deploy job (GitHub web)

The repository is public. The deploy key is a secret of the `production`
environment, whose branch rule allows `main` alone, so GitHub itself refuses
the key to a run from any other branch, even one that edits the workflow.
GitHub Free offers environments on public repositories, so the environment
and its `main` rule do not depend on GitHub Pro.

### 5.1 History review before publication (done)

Before the repository was made public, the owner reviewed its complete Git
history (every branch, tag and pull request ref, not only the current tree)
for committed secrets, environment files, database exports and user data.
It was a one-time check; no scanning tool is kept in the repository.

If a credential is ever found in the history later, rotate it at its
provider at once, and never paste it into a chat, an issue or a pull
request. Rewriting published history does not remove copies already made.

### 5.2 The `production` environment

`[GitHub web]` Repository Settings, Environments, `production`:

- Deployment branches and tags: **Selected branches and tags**, the rule
  `main` only. The page shows "1 branch rule: main".
- Secret `DEPLOY_SSH_KEY`; variables `DEPLOY_HOST` and `DEPLOY_KNOWN_HOSTS`
  (8.5).
- Required reviewers: optional. Adding yourself means each deploy waits for
  one more click.

If the environment is ever deleted, re-create it with the `main` rule
(CONFIRM) before any deploy run: a deploy run would otherwise create it
without the rule. Deleting it deletes its secrets.

### 5.3 Cancelling Pro (CONFIRM)

Before and after moving the account to GitHub Free (your account Settings,
Billing and licensing, Plans), check:

1. `[GHCR]` Your profile, Packages, `grampacker`: it still shows
   **Private** (6.1, "Package visibility and access"). If it shows Public,
   stop.
2. `[GitHub web]` Repository Settings, Environments, `production`: still
   "1 branch rule: main", and `DEPLOY_SSH_KEY` is listed.

## 6. GHCR access

### 6.1 Publishing (GitHub Actions)

`.github/workflows/image.yml` ("Image") publishes, and deploys when a
dispatch sets its `deploy` input (section 8). On a pull request it builds the
image and runs `scripts/check-image.sh`, and pushes nothing. Started by hand
on `main`, it:

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
writer pushing at the same moment. A deployment always uses the digest,
never the tag. A dispatch from any other branch runs no job.

To publish without deploying:

```bash
# [admin workstation]
git ls-remote https://github.com/$GH_REPO refs/heads/main
gh workflow run image.yml --repo "$GH_REPO" --ref main
gh run list --repo "$GH_REPO" --workflow image.yml --event workflow_dispatch --limit 1 \
  --json databaseId,headSha,status,url
```

The first command prints main's head: that is `<APP_SHA>`. Wait a few
seconds before `gh run list`; the run takes a moment to appear. Its
`headSha` must equal `<APP_SHA>`, and its `databaseId` is `<RUN_ID>`.

```bash
# [admin workstation]
gh run watch <RUN_ID> --repo "$GH_REPO" --exit-status
gh run view <RUN_ID> --repo "$GH_REPO" --log | grep -E 'published |digest +sha256:|image +ghcr'
```

Expected: "Pre-publish checks" and "Publish image to GHCR" succeed, and the
last command prints:

```text
published ghcr.io/joes703/grampacker:<APP_SHA>
digest    sha256:<64 hex>
image     ghcr.io/joes703/grampacker@sha256:<64 hex>
```

That `sha256:...` is `<APP_DIGEST>`. The run's summary page shows the same
values.

#### Package visibility and access

`[GHCR]` Your profile, Packages, `grampacker`:

1. It is **Private**. Do not make it Public: GitHub documents that a public
   package cannot be made private again. If it shows Public, stop and deploy
   nothing until it is decided.
2. It is linked to `joes703/grampacker` (the image's
   `org.opencontainers.image.source` label asks for that link).
3. Package settings, "Manage Actions access": the `grampacker` repository has
   **Write**. No other repository is listed.

The VPS pulls with its own read-only token (6.2), never with this one.

#### Verify a published image

```bash
# [VPS root]
docker pull "ghcr.io/joes703/grampacker@<APP_DIGEST>"
docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: `linux/amd64 <APP_SHA>`. Docker checks the downloaded content
against the digest, so a digest pull cannot return another image.

#### When a run fails

| Where | What it means | What to do |
| --- | --- | --- |
| "Pre-publish checks", the image build or `check-image.sh` | Nothing was pushed | Fix it through a pull request, then dispatch again from `main` |
| "already exists" | That commit is already in GHCR | Use the digest only if an earlier run for this commit **succeeded** and printed it. Otherwise treat it as the next row |
| After the push (read-back check) | The tag exists but its image was not verified | Deploy nothing from this commit. `[GHCR]` delete that package version, then rerun |
| "could not check whether ... exists" | GHCR answered the tag lookup with something other than a plain "not found", so nothing was pushed | Read the error it prints, and change nothing by hand until it is understood |
| Login or push | Usually GHCR access (above) | Check the package's Actions access, then rerun |

Rerun: `gh run rerun <RUN_ID> --repo "$GH_REPO" --failed`. A rerun keeps
the original commit and workflow file. After a successful publish a rerun
stops at "already exists" and changes nothing.

### 6.2 Renew the VPS's read-only token

The token expires after one year (section 13 records the date; keep a
calendar reminder two weeks before). To renew it, `[GitHub web]` Settings,
Developer settings, Personal access tokens, Tokens (classic), Generate new
token (classic):

- Note: `grampacker VPS GHCR pull`
- Expiration: one year.
- Scopes: **`read:packages` only.** Nothing else.

A classic token is used because GHCR did not accept fine-grained tokens for
pulls when this was set up; recheck that when you renew it. `read:packages`
cannot push or delete images. Copy the token once; it goes straight to 6.3.
Then delete the old token.

### 6.3 Log Docker in to GHCR on the VPS

The deploy script runs as root, so the credential lives in root's Docker
configuration, which `deploy` cannot read.

```bash
# [VPS root]
read -rsp 'GHCR read-only token: ' GHCR_TOKEN; echo
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u joes703 --password-stdin
unset GHCR_TOKEN
stat -c '%U:%G %a %n' /root/.docker/config.json
docker pull "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: `Login Succeeded`, `root:root 600 /root/.docker/config.json`, and
the pull downloads the image or says it is up to date. Docker warns that the
credential is stored unencrypted; that is expected here. Rerun: safe; a new
login replaces the stored credential. `docker logout ghcr.io` removes it.

## 7. Deployment files

The deployment is two containers (the app and Caddy), one SQLite data
directory, and one script. The files come from `deploy/` in the repository:

| Repository file | Installed as | What it is |
| --- | --- | --- |
| `deploy/compose.yaml` | `/srv/grampacker/compose.yaml` | The app (exact image digest, `127.0.0.1` only, UID/GID 10001, read-only root filesystem, `/tmp` tmpfs) and Caddy (`caddy:2`, host networking) |
| `deploy/Caddyfile` | `/srv/grampacker/Caddyfile` | `grampacker.app`: HTTPS, maintenance switch, proxy to the app |
| `deploy/Caddyfile.rehearsal` | only in the rehearsal directory (7.4) | The same, on `http://127.0.0.1:8081` only |
| `deploy/grampacker-deploy` | `/usr/local/sbin/grampacker-deploy` | `deploy`, `rollback`, `maintenance`, `caddy-update` |
| `deploy/grampacker-deploy-ssh` | `/usr/local/sbin/grampacker-deploy-ssh` | The GitHub deploy key's forced command (section 8) |

Beside them in `/srv/grampacker`, on the VPS only:

- `deploy.env` (no secrets, mode 0644): `APP_IMAGE` (the running digest; only
  `grampacker-deploy` changes it), `ACME_EMAIL` and `SITE_URL`. Never
  rewrite it by hand while production runs: a wrong `APP_IMAGE` is what the
  next start or rollback uses.
- `secrets/app.env` (`root:root`, mode 0600): `BETTER_AUTH_URL`,
  `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`. Never `cat` it. The
  values are in the password manager.
- `data/` (the database), `maintenance/`, `rollback/`, `caddy/` (Caddy's
  certificates and ACME account key, `root:root 700`). `snapshots/` is not
  used.

**Maintenance** is on while the file `maintenance/on` exists. Caddy then
answers 503 to every path, including `/api/*`, whether or not the app runs,
and it stays on after a Caddy restart. `grampacker-deploy maintenance on|off`
switches it and proves the result through Caddy.

**Caddy follows every 2.x release** (`caddy:2`). It changes only through
`grampacker-deploy caddy-update` (9.4). Compose pulls an image only when it
is missing, so an app deploy, a rollback or any other `docker compose`
command never pulls or replaces Caddy.

**Before changing any file in `deploy/`**, rehearse it (7.4) in the sandbox
or on the VPS. The rehearsal is the required check for deployment changes;
CI does not run it.

### 7.1 Check a new image's runtime user

Every image so far runs as UID/GID 10001, which owns `data/`. If a change to
the `Dockerfile` might change that, check before deploying:

```bash
# [VPS root]
docker run --rm --entrypoint id "ghcr.io/joes703/grampacker@<APP_DIGEST>"
```

Expected: exactly `uid=10001(app) gid=10001(app) groups=10001(app)`. If it
prints anything else, do not deploy that image.

### 7.2 Install the files from a merged `main` commit

Repeat this whenever a file in `deploy/` changes on `main`, after 7.4.

```bash
# [admin workstation] in a clean checkout of main
git -C ~/code/grampacker fetch origin
git -C ~/code/grampacker switch --detach origin/main
git -C ~/code/grampacker status --short
cd ~/code/grampacker/deploy
shasum -a 256 compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy grampacker-deploy-ssh
scp compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy grampacker-deploy-ssh joe@"$VPS_HOST":/tmp/
```

```bash
# [VPS root]
cd /tmp
sha256sum compose.yaml Caddyfile Caddyfile.rehearsal grampacker-deploy grampacker-deploy-ssh
install -o root -g root -m 0755 grampacker-deploy grampacker-deploy-ssh /usr/local/sbin/
install -o root -g root -m 0644 compose.yaml Caddyfile /srv/grampacker/
```

Expected: the two hash lists match exactly; `status --short` printed
nothing. A changed `Caddyfile` takes effect at the next `caddy-update`
(9.4); a changed `compose.yaml` at the next deploy. Keep the `/tmp` copies
only if 7.4 runs next on the VPS; otherwise delete them:
`rm /tmp/compose.yaml /tmp/Caddyfile /tmp/Caddyfile.rehearsal /tmp/grampacker-deploy /tmp/grampacker-deploy-ssh`.

### 7.3 `deploy.env`

It exists and is described in the list above. It is written only when the
VPS is set up again (a new VPS), with these three lines, and is then left to
`grampacker-deploy`:

```text
APP_IMAGE=ghcr.io/joes703/grampacker@<APP_DIGEST>
ACME_EMAIL=<the address Let's Encrypt uses for expiry notices>
SITE_URL=https://grampacker.app/
```

### 7.4 Empty-database rehearsal (for changes to `deploy/`)

Runs the real script against a separate directory,
`/srv/grampacker-rehearsal` (Compose project `grampacker-rehearsal`), with
the app on `127.0.0.1:3001` and a local-only Caddy on `127.0.0.1:8081`. It
requests no certificate, binds nothing on ports 80 or 443, and does not
touch `/srv/grampacker`, DNS, Cloudflare or production data. Prefer an agent
sandbox. On the VPS, it runs beside production: watch every block's
`GRAMPACKER_ROOT` check, because without it the same commands act on
production. Copy the changed files to `/tmp` first: on the VPS, 7.2's
first block and its `sha256sum` line, not its `install` lines, because the
rehearsal comes before installing. The rehearsal tests the change before it
merges, so in that first block switch to the pull request's head commit
(`git -C ~/code/grampacker switch --detach <PR head commit>`), not
`origin/main`.

Set up:

```bash
# [VPS root]
R=/srv/grampacker-rehearsal
install -d -m 0755 "$R" "$R/maintenance"
install -d -m 0700 "$R/data" "$R/secrets" "$R/rollback" "$R/caddy" "$R/caddy/data" "$R/caddy/config"
chown 10001:10001 "$R/data"
install -m 0644 /tmp/compose.yaml /tmp/Caddyfile.rehearsal "$R/"
install -m 0755 /tmp/grampacker-deploy "$R/grampacker-deploy"
D="$R/grampacker-deploy"
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
echo "GRAMPACKER_ROOT=$GRAMPACKER_ROOT"
```

Expected: `GRAMPACKER_ROOT=/srv/grampacker-rehearsal`. `$D` is the
candidate script from `/tmp`, not the installed one: the rehearsal tests the
change before it is installed. The secret is a
throwaway, generated here. With no `RESEND_API_KEY`, magic-link email fails
closed, which the rehearsal does not need. (`chown` with the number, not
`install -o`: the host has no account 10001, and `install -o 10001` fails
with the uutils coreutils that recent Ubuntu releases use.)

Start Caddy closed, then deploy onto the empty database:

```bash
# [VPS root] same shell
echo "GRAMPACKER_ROOT=$GRAMPACKER_ROOT"
"$D" caddy-update
"$D" deploy <APP_DIGEST>
curl -sS -w ' %{http_code}\n' http://127.0.0.1:8081/api/health
```

Expected: `GRAMPACKER_ROOT=/srv/grampacker-rehearsal`. `caddy-update` ends
with `Caddy updated: v2.x.y ..., answering 503`. `deploy` prints
`maintenance is on`, `data copied to /srv/grampacker-rehearsal/rollback/<stamp>`,
`applied N migration(s)`, `app is healthy`, `maintenance is off`,
`deployed ...`. The `curl` prints `{"ok":true} 200`.

Restart, and maintenance. After each app start, wait for the app to be
healthy (section 0, with `cd "$R"`) where the block says so:

```bash
# [VPS root] same shell
echo "GRAMPACKER_ROOT=$GRAMPACKER_ROOT"
cd "$R"
docker compose --env-file deploy.env restart app caddy
```

Wait for health, then:

```bash
# [VPS root] same shell
curl -sS -w ' %{http_code}\n' http://127.0.0.1:8081/api/health
"$D" maintenance on
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/api/categories
docker compose --env-file deploy.env restart caddy
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/
docker compose --env-file deploy.env stop app
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8081/lists/x
docker compose --env-file deploy.env start app
```

Wait for health, then `"$D" maintenance off`.

Expected: `{"ok":true} 200`, `maintenance is on`, then `503` three times
(an API path, after a Caddy restart, with the app stopped), then
`maintenance is off`.

Rollback. The first deploy had no previous image, so deploy once more,
then roll back to the point that deploy made:

```bash
# [VPS root] same shell
echo "GRAMPACKER_ROOT=$GRAMPACKER_ROOT"
"$D" deploy <APP_DIGEST>
ls "$R/rollback"
cat "$R/rollback/<newest stamp>/previous-image"
"$D" rollback "$R/rollback/<newest stamp>"
"$D" maintenance on
"$D" rollback "$R/rollback/<newest stamp>"
"$D" maintenance off
```

Expected: `previous-image` holds `ghcr.io/joes703/grampacker@<APP_DIGEST>`.
The first `rollback` refuses with `turn maintenance on first`. The second
prints `current data moved to .../failed-data-<time>`, `app is healthy`,
`rolled back to ...` and `maintenance is still on`. Then `maintenance is
off`.

Tear down, and leave no rehearsal state in the shell:

```bash
# [VPS root] same shell
cd "$R" && docker compose --env-file deploy.env down
cd /
unset GRAMPACKER_ROOT R D
rm -rf /srv/grampacker-rehearsal
rm -f /tmp/compose.yaml /tmp/Caddyfile /tmp/Caddyfile.rehearsal /tmp/grampacker-deploy /tmp/grampacker-deploy-ssh
echo "GRAMPACKER_ROOT=${GRAMPACKER_ROOT:-unset}"
ls /srv
```

Expected: `GRAMPACKER_ROOT=unset`, and no `grampacker-rehearsal` in `/srv`.
Close this root shell anyway; use a new one for production (section 0).

## 8. GitHub-to-VPS deployment

One dispatch of the Image workflow publishes `main`'s head and, when its
`deploy` box is ticked, deploys exactly that digest:

1. `[GitHub Actions]` "Publish image to GHCR" pushes and checks the image
   and hands its digest to "Deploy to the VPS". Nobody types a digest or a
   tag. The deploy job runs only on `main` in `joes703/grampacker`, in the
   `production` environment, one at a time, and is never canceled once
   started.
2. It connects as `deploy` with a key from GitHub, checks the VPS's host
   key against the one pinned in GitHub (never `ssh-keyscan`), and sends
   `deploy sha256:<64 hex>`.
3. `[VPS]` The key's `authorized_keys` line has
   `restrict,command="/usr/local/sbin/grampacker-deploy-ssh"`. Whatever the
   client asks for, sshd runs that wrapper instead. `restrict` turns off PTY
   allocation, port, agent and X11 forwarding, and `~/.ssh/rc`.
4. The wrapper accepts only `deploy sha256:<64 lowercase hex>`, then runs
   itself through `sudo` with the digest. The sudo rule allows `deploy` that
   one program and nothing else.
5. As root, the wrapper checks the digest again and runs
   `grampacker-deploy deploy <digest>` in its own session, with the output in
   `/var/log/grampacker-deploy/<time>-<pid>.log`. The job shows the log. If
   the connection drops or the run is canceled, the deploy still runs to its
   end on the VPS.

The `deploy` account cannot roll back, switch maintenance, update Caddy,
write files, open a shell or name a tag. It can deploy any digest that
exists in `ghcr.io/joes703/grampacker`, older ones included.

**A failed deploy is not rolled back.** The job fails, maintenance stays on,
and the log names the rollback directory. Decide as for a manual deploy
(9.2), as root.

**Manual root deployment stays** (9.1, "Manual"): it is the recovery path
when GitHub, the key or the account does not work, and the way to deploy an
image published earlier.

8.2 to 8.5 are already done. Run them again only to rotate the key (8.7),
after a VPS move, or if the account was removed.

### 8.1 Before you start

- The `production` environment exists with its `main` rule (5.2).
- The host key fingerprint is recorded in section 13 (1.2).
- 7.2 has installed `/usr/local/sbin/grampacker-deploy-ssh` from the same
  `main` commit as `grampacker-deploy`.
- Keep a second `joe` SSH session open while changing sudo (2.1).

### 8.2 Create the account and the sudo rule

```bash
# [VPS root]
adduser --disabled-password --comment 'GitHub Actions deploy' --shell /bin/bash deploy
tee /etc/sudoers.d/50-grampacker-deploy >/dev/null <<'RULE'
# GitHub deploy (runbook section 8): only the forced command, which accepts one image digest.
deploy ALL=(root) NOPASSWD: /usr/local/sbin/grampacker-deploy-ssh
RULE
chmod 0440 /etc/sudoers.d/50-grampacker-deploy
visudo -c
id deploy
passwd -S deploy
sudo -l -U deploy
ls -l /usr/local/sbin/grampacker-deploy-ssh
```

Expected:

- `visudo -c` reports `parsed OK` for every file.
- `id`: the primary group is `deploy`. Ubuntu's `adduser` may also add the
  account to `users`, which grants nothing here. No `sudo`, `docker` or
  `adm`: any of those is a stop.
- `passwd -S` shows `deploy L` (no password; keys only).
- `sudo -l -U deploy` lists exactly one command:
  `(root) NOPASSWD: /usr/local/sbin/grampacker-deploy-ssh`.
- The wrapper is `-rwxr-xr-x root root`.

The shell is bash, not `nologin`, because sshd runs even a forced command
through the account's shell. The forced command is what refuses a shell.

### 8.3 Create the key and install it

The key has no passphrase: a GitHub job cannot type one, and GitHub stores
the secret encrypted. The private key leaves the admin workstation only for
GitHub (8.5), and is then deleted. Run 8.3 to 8.5 on the same workstation:
the key file exists only there.

```bash
# [admin workstation]
( umask 077; ssh-keygen -t ed25519 -N '' -C "grampacker-github-deploy-$(date -u +%F)" -f ~/grampacker-deploy-key )
ssh-keygen -lf ~/grampacker-deploy-key.pub
scp ~/grampacker-deploy-key.pub joe@"$VPS_HOST":/tmp/grampacker-deploy-key.pub
```

```bash
# [VPS root]
ssh-keygen -lf /tmp/grampacker-deploy-key.pub
install -d -o root -g root -m 0755 /home/deploy /home/deploy/.ssh
printf 'restrict,command="/usr/local/sbin/grampacker-deploy-ssh" %s\n' "$(cat /tmp/grampacker-deploy-key.pub)" >/home/deploy/.ssh/authorized_keys
chmod 0644 /home/deploy/.ssh/authorized_keys
rm /tmp/grampacker-deploy-key.pub
cat /home/deploy/.ssh/authorized_keys
ssh-keygen -lf /home/deploy/.ssh/authorized_keys
```

Expected: the same `SHA256:...` fingerprint three times, and one line
starting `restrict,command="/usr/local/sbin/grampacker-deploy-ssh"
ssh-ed25519`. The home directory, `.ssh` and the file belong to root, so
the account cannot change its own key's limits or its shell's startup
files. Rerun: safe; the file is replaced.

### 8.4 Verify the limits

```bash
# [admin workstation]
K=(-i ~/grampacker-deploy-key -o IdentitiesOnly=yes -o BatchMode=yes)
ssh "${K[@]}" deploy@"$VPS_HOST"; echo "exit=$?"; sleep 10
ssh "${K[@]}" deploy@"$VPS_HOST" 'maintenance off'; echo "exit=$?"; sleep 10
ssh "${K[@]}" deploy@"$VPS_HOST" 'deploy ghcr.io/joes703/grampacker:latest'; echo "exit=$?"; sleep 10
ssh "${K[@]}" -tt deploy@"$VPS_HOST" 'id'; echo "exit=$?"; sleep 10
ssh "${K[@]}" -o ExitOnForwardFailure=yes -R 127.0.0.1:18099:127.0.0.1:22 deploy@"$VPS_HOST" 'id'; echo "exit=$?"; sleep 10
scp "${K[@]}" ~/grampacker-deploy-key.pub deploy@"$VPS_HOST":/tmp/deploy-wrote-this; echo "exit=$?"; sleep 10
ssh "${K[@]}" deploy@"$VPS_HOST" "deploy sha256:$(printf '0%.0s' {1..64})"; echo "exit=$?"
```

The `sleep 10` keeps these seven connections under UFW's SSH rate limit
(`ufw limit`: more than 6 new connections from one address in 30 seconds
are dropped). Without it, the later tests time out at the firewall and
never reach sshd, so they prove nothing. A `Connection timed out` or
`Connection refused` here means the limit was hit: wait a minute and run
the remaining lines again.

Expected:

- The first three print `ERROR: refused. The only accepted command is:
  deploy sha256:<64 lowercase hex>` and `exit=2`.
- `-tt`: sshd refuses the PTY (`restrict`), and the client may then give up
  before the wrapper runs: `PTY allocation request failed on channel 0`
  and `exit=255`, with no `ERROR: refused` line. That is a secure result:
  nothing ran. The wrapper's refusal and `exit=2` is also acceptable.
  Output from `id` is a stop.
- `-R`: `remote port forwarding failed`, `exit=255`.
- `scp` fails, and `/tmp/deploy-wrote-this` does not exist on the VPS.
- The all-zero digest passes the wrapper and sudo, and `grampacker-deploy`
  stops it before it changes anything: it prints `grampacker-deploy-ssh:
  deploy sha256:000..., log /var/log/grampacker-deploy/...`, then a failed
  pull (that image does not exist), then `grampacker-deploy-ssh: exit 1`
  and `exit=1`. Maintenance is not touched: the pull comes first.

Any other result: stop, and remove the access (8.7).

### 8.5 Store the key and pin the host key in GitHub

Read the host key over the `joe` connection, which the workstation already
checks against the key it trusts (1.2):

```bash
# [admin workstation]
HOSTKEY="$(ssh joe@"$VPS_HOST" cat /etc/ssh/ssh_host_ed25519_key.pub | cut -d' ' -f1,2)"
printf '%s %s\n' "$VPS_HOST" "$HOSTKEY" | ssh-keygen -lf -
```

Expected: the fingerprint in section 13. If it differs, stop.

```bash
# [admin workstation]
gh secret set DEPLOY_SSH_KEY --repo "$GH_REPO" --env production <~/grampacker-deploy-key
gh variable set DEPLOY_HOST --repo "$GH_REPO" --env production --body "$VPS_HOST"
gh variable set DEPLOY_KNOWN_HOSTS --repo "$GH_REPO" --env production --body "$VPS_HOST $HOSTKEY"
gh secret list --repo "$GH_REPO" --env production
gh variable list --repo "$GH_REPO" --env production
rm -f ~/grampacker-deploy-key ~/grampacker-deploy-key.pub
```

Expected: `DEPLOY_SSH_KEY` listed as a secret; `DEPLOY_HOST` and
`DEPLOY_KNOWN_HOSTS` with the values above. A lost key is never recovered
from GitHub: make a new one (8.7). After a VPS move, set `DEPLOY_HOST` and
`DEPLOY_KNOWN_HOSTS` again.

### 8.6 Test

A deploy from GitHub (9.1) is the test. It deploys `main`'s head.

### 8.7 Rotate or remove

**Rotate:** 8.3 with a new key (the new line replaces the old one), 8.4,
then 8.5's `gh secret set` and `rm`.

**Remove completely.** GitHub first:

```bash
# [admin workstation]
gh secret delete DEPLOY_SSH_KEY --repo "$GH_REPO" --env production
gh variable delete DEPLOY_HOST --repo "$GH_REPO" --env production
gh variable delete DEPLOY_KNOWN_HOSTS --repo "$GH_REPO" --env production
```

```bash
# [VPS root]
rm -f /etc/sudoers.d/50-grampacker-deploy
visudo -c
pkill -u deploy || true
deluser --remove-home deploy
getent passwd deploy || echo "deploy account removed"
sudo -l -U deploy
```

Expected: `parsed OK`, `deploy account removed`, and `sudo` reports an
unknown user. The wrapper in `/usr/local/sbin` stays and does nothing
without the account and the rule; the logs in `/var/log/grampacker-deploy`
stay as a record.

```bash
# [admin workstation]
ssh -o BatchMode=yes deploy@"$VPS_HOST" true; echo "exit=$?"
```

Expected: `Permission denied (publickey)`, `exit=255`. Publishing still
works; a dispatch with `deploy` ticked now fails in the deploy job with
`... is not set`. Deploy by hand (9.1, "Manual") until it is set up again.

## 9. Routine operations

### 9.1 Deploy

**From GitHub:** publish `main`'s head and deploy it in one run.

```bash
# [admin workstation]
gh workflow run image.yml --repo "$GH_REPO" --ref main -f deploy=true
gh run list --repo "$GH_REPO" --workflow image.yml --event workflow_dispatch --limit 1 --json databaseId,headSha,url
gh run watch <RUN_ID> --repo "$GH_REPO" --exit-status
```

The deploy job prints the VPS's log, which ends
`grampacker-deploy-ssh: exit 0` on success. A failed deploy job is handled
like a failed manual deploy (9.2). Rerunning that job
(`gh run rerun <RUN_ID> --repo "$GH_REPO" --failed`) sends the same digest
again; do it only when you would run the same manual deploy again. If the
run was canceled or timed out, the deploy may still be running: read the
newest `/var/log/grampacker-deploy/*.log` as root.

**Manual** (recovery, or an image published earlier, whose commit GitHub
will not publish again). The digest is one the Image workflow printed for a
run on `main` (6.1).

```bash
# [admin workstation]
ssh -t joe@"$VPS_HOST" 'sudo /usr/local/sbin/grampacker-deploy deploy <APP_DIGEST>'
```

`-t` lets `sudo` ask for `joe`'s password. `sudo` here starts from a clean
environment, so `GRAMPACKER_ROOT` cannot leak in. Both paths run the same
script, which refuses anything but a bare `sha256:` digest. In order, it:

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
# [admin workstation]
curl -sS -w ' %{http_code}\n' https://grampacker.app/api/health
```

Expected: `{"ok":true} 200`. Then check what is running:

```bash
# [VPS root]
cd /srv/grampacker
docker inspect -f '{{.Config.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$(docker compose --env-file deploy.env ps -q app)"
docker compose --env-file deploy.env exec -T app node --version
```

Expected: `ghcr.io/joes703/grampacker@<APP_DIGEST>`, then the `main` commit
the Image run built, and the Node version in that commit's `Dockerfile`
`FROM` line. Rerun: safe; the same digest redeploys and makes a new rollback
directory.

### 9.2 When a deploy fails

The script prints `DEPLOY FAILED`, whether maintenance is still on, and the
rollback directory (or that none was made, in which case `data/` was not
changed). No public write has happened since the copy, so restoring it is
safe. In a production root shell (section 0):

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
data is untouched: start the image that was running.

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env up -d --no-deps app
```

Wait for the app to be healthy (section 0), then
`grampacker-deploy maintenance off`.

The script refuses to roll back a deploy whose `previous-image` is empty.
If the message said the maintenance file was already removed, the site may
have reopened: 9.3 applies.

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

It pulls `caddy:2`, validates `/srv/grampacker/Caddyfile` with that image,
recreates only Caddy, and waits up to a minute for the site to answer 200
(or 503 while maintenance is on). It prints the running Caddy's version;
record it in section 13. If validation fails, the running Caddy is not
touched, and `caddy:2` points back at the image it runs. Run it at least
monthly (9.6), and within a few days of a Caddy security release.

### 9.5 Disk space and image cleanup

Each deploy leaves one rollback directory, about the size of the database.
Nothing deletes them. A rollback directory is only the immediate way back
from one deploy. When a deploy has run well for a while, delete older
rollback directories by hand, keeping the newest few:

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

### 9.6 Keeping production patched

A merge changes `main`, not production. Merged fixes reach the VPS only like
this:

| Component | What brings the fix | What puts it into production |
| --- | --- | --- |
| npm packages | A Dependabot PR (or SECURITY.md's manual path) changing `package-lock.json` | Deploy `main` (9.1) |
| Node and Debian in the image | A Dependabot PR changing the `Dockerfile`'s `FROM` line | Deploy `main` |
| Caddy | Caddy's own release of `caddy:2` | `grampacker-deploy caddy-update` (9.4) |
| The VPS itself | Ubuntu and Docker packages | Section 3 |

Rebuilding an unchanged commit gains almost nothing: the fixes come in when a
PR moves a pinned version or digest. Targets:

- **A security fix** (a Dependabot security PR, the manual path, a Node
  security release, a Caddy or Docker security release): deploy, or update,
  as soon as practical, the same day when possible.
- **Any other merged change to `Dockerfile`, `package.json` or
  `package-lock.json`:** deploy within seven days. A change only to
  development packages does not need a deploy; when unsure, deploy.

After every deploy, check what is running (9.1).

**Monthly check** (first week of the month):

1. **Is production behind `main`?**

   ```bash
   # [VPS root]
   cd /srv/grampacker
   docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
     "$(docker compose --env-file deploy.env ps -q app)"
   ```

   ```bash
   # [admin workstation] in the repository
   git fetch origin
   git log --oneline <REVISION>..origin/main -- Dockerfile package.json package-lock.json
   ```

   `<REVISION>` is the commit the first command printed. Empty output:
   production has every merged dependency and base-image change. Otherwise
   deploy.
2. **Did the base-image updates arrive?**

   ```bash
   # [admin workstation]
   git show origin/main:Dockerfile | grep '^FROM node:'
   docker buildx imagetools inspect node:24-trixie-slim \
     --format '{{json .Manifest.Digest}} {{range (index .Image "linux/amd64").Config.Env}}{{.}} {{end}}'
   gh pr list --repo joes703/grampacker --author app/dependabot
   ```

   `node:24-trixie-slim` is always the newest Node 24 build; the second
   command prints its digest and `NODE_VERSION`. If that digest is the one
   after `@` in the `FROM` line, the pin is current. If not, a Dependabot PR
   for `node` should be open. If none is open:
   - Same Node version, different digest: the tag was rebuilt (usually for
     Debian fixes), and Dependabot may not raise those
     (`.github/dependabot.yml`). Update the line by hand
     (`docs/container-image.md`).
   - A newer Node version, released more than two days ago: Dependabot has
     stopped. Read its log (Insights, Dependency graph, Dependabot), and
     update the line by hand meanwhile.

   Merge or close Dependabot PRs older than a week.
3. **Caddy:** `grampacker-deploy caddy-update` (9.4).
4. **The host:**

   ```bash
   # [VPS joe]
   sudo apt-get update
   apt list --upgradable
   sudo apt-get upgrade --with-new-pkgs
   cat /var/run/reboot-required.pkgs
   ```

   This applies what `unattended-upgrades` leaves (Docker's packages).
   Upgrading Docker restarts both containers for a few seconds; do it at a
   quiet time. Reboot if section 3 says so. Then do section 3's check: wait
   for health, then `ps` and the health request.

### 9.7 Troubleshooting

| Symptom | Check | What to do |
| --- | --- | --- |
| The site does not answer | `curl -sS -w ' %{http_code}\n' https://grampacker.app/api/health`; on the VPS, `docker compose --env-file deploy.env ps` | A stopped container: read its log (below), then start it and wait for health (section 0). A `503` with the maintenance text: maintenance is on; find out why before `maintenance off` |
| `grampacker.app` does not resolve, or resolves to an old address, on one machine | `dig +short A grampacker.app` and `dig +short A grampacker.app @1.1.1.1` | If only the first is wrong and the machine runs Tailscale, Tailscale is holding a stale answer (tailscale/tailscale#21816): disconnect and reconnect Tailscale, then check again. If `@1.1.1.1` is wrong too, check the record in Cloudflare |
| A check fails right after a start or restart | The app's health state (section 0) | Wait for `healthy`, then check again. `unhealthy` is a real failure: read the log |
| A `grampacker-deploy` command acts on the wrong directory | `echo "${GRAMPACKER_ROOT:-unset}"` | Use a new root shell (section 0) |
| Certificate errors | `docker compose --env-file /srv/grampacker/deploy.env logs --since 1h caddy` | DNS must point at the VPS, DNS only (not proxied), and ports 80 and 443 must be open |
| A deploy run fails | The run's log, and the newest `/var/log/grampacker-deploy/*.log` | 9.2. `Host key verification failed`: `DEPLOY_KNOWN_HOSTS` is wrong (8.5). `Permission denied (publickey)`: the key or `authorized_keys` is (8.3) |
| `ssh -tt deploy@...` fails with `PTY allocation request failed` | none | Expected and secure (8.4) |

App and Caddy logs:

```bash
# [VPS root]
cd /srv/grampacker
docker compose --env-file deploy.env logs --since 1h app
docker compose --env-file deploy.env logs --since 1h caddy
```

## 10. D1 export and import (done)

The import ran once, at cutover (section 4), with `import-d1`
(`server/db/import-d1.ts`). It is not run again: production's SQLite
database is the source of truth, and D1 has been stale since the cutover.

What remains is reading D1 while it exists, for example the optional final
archive export before D1 is deleted (12.3).

### 10.1 D1 data rules

**An export of D1 is production data.** It holds every user's email address,
passkey public keys and all lists as they were at the cutover:

- keep it only in a `0700` directory as `0600` files, never in a repository
  checkout, never in GitHub (no issue, no Actions artifact), never in an
  image (`.gitignore` and `.dockerignore` name `d1-full*.sql` and
  `d1-counts*.json` as a second guard);
- never `cat`, `less` or paste it;
- **`wrangler d1 export` prints a temporary signed URL.** Anyone who has
  that URL can download the whole export for one hour. Never paste, share
  or log the export command's output, or put it in notes, an issue or a
  chat. Wrangler also writes it to a debug log file on disk by default;
  `WRANGLER_WRITE_LOGS=false` stops that, and every export below sets it.
  If the URL was copied anywhere within the hour, treat that as a leak of
  the export.

### 10.2 Export D1 (walnut)

Read-only on D1. Uses walnut's `wrangler login`.

```bash
# [walnut] in the repository checkout, on main
umask 077
export WRANGLER_WRITE_LOGS=false
STAMP=final-$(date -u +%Y%m%dT%H%MZ)
OUT=~/grampacker-d1-export/$STAMP
mkdir -p "$OUT"
npx wrangler d1 export grampacker --remote --output "$OUT/d1-full.sql"
(cd "$OUT" && sha256sum d1-full.sql > SHA256SUMS)
ls -la ~/grampacker-d1-export "$OUT"
```

Expected: the export finishes with `Done!` (its output includes the signed
URL: do not copy it); two `-rw-------` files in a `drwx------` directory.
Where the export goes next is the owner's decision (12.3); delete the
plaintext copy on walnut once it is stored:
`rm -rf ~/grampacker-d1-export/<STAMP>`.

## 11. Cutover (done) and return to the Worker

### 11.1 Cutover

Done on 2026-10-16 (section 4). D1 has been stale since then: every write
since is only in the VPS's SQLite database.

### 11.2 Rollback to the Worker and D1

While the Worker and D1 exist, they can take traffic back. **This loses
data:** D1 holds the state of 2026-10-16, and nothing copies the VPS's later
writes back to it. It is a last resort for a VPS that cannot be fixed or
restored in time, and needs a written decision first: what is broken, why a
fix-forward or 9.3 cannot work, and which writes are lost.

1. `[VPS root]` In a production root shell (section 0), stop writes and
   keep the VPS's data as it is. Do not move or delete anything in `data/`
   or `rollback/`: it is the newest copy of production.

   ```bash
   # [VPS root]
   grampacker-deploy maintenance on
   ```

   If that fails (Caddy broken), stop the app instead:
   `cd /srv/grampacker && docker compose --env-file deploy.env stop app`.
   If the VPS cannot be reached at all, power it off from the RackNerd
   control panel; its disk is kept. Never reopen D1 (step 3) while the VPS
   might still accept writes.

2. `[Cloudflare]` Delete the `grampacker.app` A record that points at the
   VPS (CONFIRM: production DNS).
3. `[Cloudflare]` Workers & Pages, `grampacker`, Settings, Domains &
   Routes: add the custom domain `grampacker.app` (CONFIRM: Worker route).
   Cloudflare creates its own DNS record. This reopens writes to D1. Leave
   `workers.dev` and preview URLs off.
4. Verify:

   ```bash
   # [admin workstation]
   dig +short A grampacker.app @1.1.1.1
   curl -sS -w ' %{http_code}\n' https://grampacker.app/api/health
   ```

   Expected: Cloudflare addresses, not `$VPS_HOST`, and `{"ok":true} 200`
   from the Worker. If the admin workstation still reaches the VPS, see 9.7
   (Tailscale). Then sign in once in a browser to confirm. Users sign in
   again on the Worker.

5. The Worker keeps serving the last version it deployed. Do **not** turn
   `deploy.yml` back on, and never re-run an earlier Deploy run: `main`
   contains Node/SQLite code, and either can deploy code the Worker cannot
   run (`AGENTS.md` "Shipping"). A security fix for the Worker:
   `docs/testing-and-ci.md` section 11.

Returning to the VPS later is a new migration from D1 with its own plan.
`import-d1` refuses an existing database, so the kept VPS data must first
be moved out of `data/`, never deleted.

## 12. After cutover

### 12.1 Copies of production data

| Copy | Where | State |
| --- | --- | --- |
| Rehearsal export, counts and database | walnut, `/srv/grampacker-rehearsal` | deleted, 2026-10-16 |
| Cutover export (plaintext) | walnut, VPS `/srv/grampacker/import/` | deleted, 2026-10-16 |
| Rollback directories, including any `cutover-imported-*` copy of the database as imported | VPS `/srv/grampacker/rollback/` | kept until deleted by hand (9.5) |
| D1 | Cloudflare | kept until decommissioned (12.3) |

The import reports (`*-import-report.txt`) hold no user data and may be
kept with your notes.

### 12.2 Observe for two weeks (until 2026-10-30)

Daily for the first week, then weekly:

```bash
# [admin workstation]
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

Expected: `ok`. The copy is from the last deploy.

### 12.3 Decommission (separate approvals)

Each is its own decision, after the observation period. Until the Worker and
D1 are deleted, 11.2 stays available.

- Optionally, archive a final D1 export (10.2) in protected storage.
- Remove the Worker deployment code (`deploy.yml`), `wrangler` and Cloudflare-only
  dependencies (a normal PR).
- `[GitHub web]` Delete `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- `[Resend]` Revoke the old Worker's API key.
- Replace `docs/d1-restore.md` with the SQLite restore procedure.
- Delete the Worker, then the D1 database: **only** with separate, explicit
  approval. After that, remove 11.2 from this runbook.

## 13. Records

| Item | Value |
| --- | --- |
| VPS host key fingerprint (ED25519) | `SHA256:6R0gvuvxXgw7m7zjTJrouxWooIcVlnLI6IAxtUQth48` |
| Cutover | completed 2026-10-16 |
| Production image | `ghcr.io/joes703/grampacker@sha256:453b52ee9d2976efce708906536d78062cf50459da3ef0127398754bde4a5c49`, deployed by run 38957454976 |
| Import rehearsal image | `sha256:e36ab22844e9dece0e4b60f6e973b919bcc61a4e00102ffbb81f230d5fca518f` (2026-10-16) |
| GitHub-to-VPS test image | `sha256:16575850faf2365f64ed50585f1055267a31ee64f953b623d9823e29b3c6ed52` (2026-10-15/16) |
| Image runtime UID | 10001 |
| GitHub deploy key: fingerprint, created | |
| GHCR token expiry date | |
| Caddy version after each `caddy-update` | 2.11.7 (2026-10-15) |
| Worker rollback target: commit, Cloudflare version id (`docs/testing-and-ci.md` section 11, step 1) | commit `5ba1d5b635948d24f5196c0f21192750bd2f954d`; version `3a21d4fe-d237-4273-83f3-1a0d0c963229` |
| Worker hotfixes: branch, commit, Cloudflare version id and time (`docs/testing-and-ci.md` section 11) | |
| Known issue | Tailscale held a stale negative DNS answer for `grampacker.app` after the cutover until reconnected: tailscale/tailscale#21816 |
