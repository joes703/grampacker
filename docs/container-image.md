# The production container image

How the image is built, what it contains, who it runs as, and how to test
it. The deployment that uses it is `docs/vps-runbook.md`.

## Commands

```bash
docker build --platform linux/amd64 -t grampacker .
docker run --rm -v "$PWD/data:/data" grampacker migrate        # apply migrations
docker run -d -v "$PWD/data:/data" --env-file app.env grampacker  # serve (the default)
scripts/check-image.sh grampacker                               # test a built image
```

The entrypoint is `node /app/dist/server/node.js`. Its argument is the
command: `serve` (the default `CMD`) or `migrate`. `serve` never changes the
schema. It exits 1 while a migration is pending, so a deploy runs `migrate`
explicitly, after it has stopped the app and copied the data directory
(`deploy/grampacker-deploy`).

## Base image

Every stage uses the same official Node image, pinned by version and
digest in the Dockerfile's first `FROM` line (the `base` stage):

- **Node 24**, the current LTS line.
- **Debian (glibc), `-slim`.** better-sqlite3 loads a prebuilt glibc binary
  from its npm package (`prebuilds/linux-x64.node`), so no compiler is
  needed. Alpine uses musl, which that binary does not support. The build
  and runtime stages must share the C library, so they share the image.
- **linux/amd64**, the VPS's platform.

Dependabot updates that line daily (`.github/dependabot.yml`), within
Node 24. It changes the tag and the digest together. Because Dependabot may
skip a rebuild of the same tag, the VPS runbook's monthly maintenance includes
checking the pin against the newest image. To choose or update the pin by hand:

```bash
docker pull --platform linux/amd64 node:24-trixie-slim
docker run --rm --platform linux/amd64 node:24-trixie-slim node --version
docker buildx imagetools inspect node:24-trixie-slim
```

Set the `FROM` line to `node:<that version>-trixie-slim@sha256:<index digest>`:
the exact version tag, plus the digest of the multi-platform index that
`imagetools inspect` prints as `Digest:`. The digest is what Docker
enforces; the tag is there for people. Rebuild and run
`scripts/check-image.sh` before committing the new pin.

The `Dockerfile` is the record of the current pin; this page does not
repeat it, so an update leaves nothing here out of date. `trixie` is
Debian 13, with glibc 2.41.

A digest names content, so the pin cannot move when the tag does. The
build's `--platform linux/amd64` selects the amd64 manifest from the index.

## The runtime user

The server runs as `app`, **UID 10001, GID 10001**, a fixed number the
Dockerfile creates. The host's bind-mounted data directory must be owned by
that number (`chown 10001:10001`, mode 0700). It is not 1000, so it never
matches an ordinary login user on the host, and that user needs `sudo` to
read the database.

Root owns everything under `/app`, so the server cannot change its own
code. The image is tested with a read-only root filesystem and a tmpfs on
`/tmp`, as the runbook's Compose file runs it.

## What the image contains

Under `/app`, and nothing else from the repository:

| Path | Why |
| --- | --- |
| `package.json` | `"type": "module"` makes Node load `dist/server/*.js` as ES modules |
| `node_modules/` | production dependencies only (`npm ci --omit=dev --omit=optional`, below) |
| `migrations/*.sql`, `migrations/meta/_journal.json` | what `migrate` applies; the snapshots are not needed |
| `dist/server/node.js`, `dist/server/healthcheck.js` | the compiled server and health check, no source maps |
| `dist/client/` | the built SPA |

npm, npx, corepack and yarn are removed: production never runs them.

`--omit=dev` alone leaves vitest, vite, drizzle-kit, tsx, jsdom and esbuild
in the image. better-auth names them as optional peer dependencies, so the
lockfile marks them `devOptional`, and npm keeps those. `--omit=optional`
removes them. When this was chosen, every package the production
dependencies require (193, following required dependencies and required
peers in the lockfile) was still installed with it. The check script fails
if npm records any dev package as installed. One devDependency remains on
purpose: `@types/react`, which `react-markdown` requires as a peer. It holds
only type declarations.

`node_modules` also holds the SPA's libraries (React and others), because
they are production dependencies in `package.json`. The server never loads
them; they are already bundled into `dist/client`.

`NODE_ENV` is `production`. In this app that changes one thing:
better-auth's `/api/auth/error` redirects to `/?error=...` instead of
serving its own HTML page. Its rate limiter is off in `server/auth.ts`, and
the `https` base URL, not `NODE_ENV`, chooses the secure cookie names. The
API tests run without `NODE_ENV`; the check script proves the redirect from
the real container.

The build context is an allowlist (`.dockerignore`), so `.git`, `.env*`,
`dist/`, `.data/`, SQLite files and tests never reach any stage. The image
builds `build:client` and `build:server` directly.

## Health check

`HEALTHCHECK` runs `node /app/dist/server/healthcheck.js`
(`server/healthcheck.ts`). Healthy means `GET /api/health` answers HTTP 200
with a JSON body whose `ok` is exactly `true`, within 3 seconds. Docker's
timeout is 5 seconds, so the script's printed reason, not a kill, is what
`docker inspect` shows.

## What `scripts/check-image.sh` proves

It runs the real image with a throwaway data directory and configuration:

1. The image is linux/amd64.
2. It runs as 10001:10001, not root, with `NODE_ENV=production`.
3. `serve` on an unmigrated database exits 1 within 30 seconds and
   creates no table.
   `migrate` into a directory the app user cannot write fails.
4. `migrate` applies every migration, and a second run applies none.
5. `serve` on that database becomes healthy.
6. Health, the SPA shell, a deep link, a hashed asset (immutable cache), a
   missing asset (404), an unknown API route (404 JSON) and better-auth's
   production error redirect answer correctly. The server runs with a
   read-only root filesystem and a tmpfs `/tmp`.
7. Data survives: a sign-in rate-limit bucket filled in one container still
   answers 429 from its replacement on the same directory.
8. SIGTERM (`docker stop`) exits 0 after a graceful shutdown.
9. No secrets, databases, source-control files, npm or development
   dependencies are anywhere in the image, and the app's own files
   (`dist/`, `migrations/`) hold no tests, source maps or TypeScript.
   Production packages in `node_modules` keep the files they publish,
   which include some `.map` and `.d.ts` files.
10. It prints the image size and startup memory as measurements, not limits.

## Publishing

`.github/workflows/image.yml` runs the build and `scripts/check-image.sh` on
every pull request. Started by hand on main, it also pushes the checked
image to `ghcr.io/joes703/grampacker:<full commit SHA>` with
`scripts/publish-image.sh`, which refuses to replace an existing tag (a
check just before the push, not atomic) and prints the digest to deploy.
Procedure and checks: `docs/vps-runbook.md`, "Deploy".

## Notes

A refused `serve` still leaves an empty database file behind: opening
SQLite creates it before the migration check runs. It has no tables, and
`migrate` uses it normally.
