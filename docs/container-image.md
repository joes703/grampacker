# The production container image

How the image is built, what it contains, who it runs as, and how to test
it. The deployment that uses it is `docs/vps-bootstrap-and-migration-runbook.md`.

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
explicitly, after a snapshot.

## Base image

Every stage uses the same official Node image, pinned by version and
digest in the Dockerfile's `NODE_IMAGE`:

- **Node 24**, the current LTS line.
- **Debian (glibc), `-slim`.** better-sqlite3 loads a prebuilt glibc binary
  from its npm package (`prebuilds/linux-x64.node`), so no compiler is
  needed. Alpine uses musl, which that binary does not support. The build
  and runtime stages must share the C library, so they share the image.
- **linux/amd64**, the VPS's platform.

To choose or update the pin:

```bash
docker pull --platform linux/amd64 node:24-trixie-slim
docker run --rm --platform linux/amd64 node:24-trixie-slim node --version
docker buildx imagetools inspect node:24-trixie-slim
```

Set `NODE_IMAGE` to `node:<that version>-trixie-slim@sha256:<index digest>`:
the exact version tag, plus the digest of the multi-platform index that
`imagetools inspect` prints as `Digest:`. The digest is what Docker
enforces; the tag is there for people. Rebuild and run
`scripts/check-image.sh` before committing the new pin.

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
| `node_modules/` | production dependencies only (`npm ci --omit=dev`) |
| `migrations/*.sql`, `migrations/meta/_journal.json` | what `migrate` applies; the snapshots are not needed |
| `dist/server/node.js`, `dist/server/healthcheck.js` | the compiled server and health check, no source maps |
| `dist/client/` | the built SPA |

npm, npx, corepack and yarn are removed: production never runs them.
`NODE_ENV` is deliberately unset. better-auth changes its error page and a
cookie-name fallback when it is `production`, and the Worker never set it.

The build context is an allowlist (`.dockerignore`), so `.git`, `.env*`,
`.dev.vars`, Wrangler files, `dist/`, `.data/`, SQLite files and tests
never reach any stage. The image builds `build:client` and `build:server`,
never `npm run build`: that also runs the Cloudflare build, which copies
`.dev.vars` into `dist/`.

## Health check

`HEALTHCHECK` runs `node /app/dist/server/healthcheck.js`
(`server/healthcheck.ts`). Healthy means `GET /api/health` answers HTTP 200
with a JSON body whose `ok` is exactly `true`, within 3 seconds. Docker's
timeout is 5 seconds, so the script's printed reason, not a kill, is what
`docker inspect` shows.

## What `scripts/check-image.sh` proves

It runs the real image with a throwaway data directory and configuration:

1. The image is linux/amd64.
2. It runs as 10001:10001, not root.
3. `serve` on an unmigrated database exits 1 within 30 seconds and
   creates no table.
   `migrate` into a directory the app user cannot write fails.
4. `migrate` applies every migration, and a second run applies none.
5. `serve` on that database becomes healthy.
6. Health, the SPA shell, a deep link, a hashed asset (immutable cache), a
   missing asset (404) and an unknown API route (404 JSON) answer correctly.
7. Data survives: a sign-in rate-limit bucket filled in one container still
   answers 429 from its replacement on the same directory.
8. SIGTERM (`docker stop`) exits 0 after a graceful shutdown.
9. No secrets, databases, source-control files, npm or development
   dependencies are anywhere in the image, and the app's own files
   (`dist/`, `migrations/`) hold no tests, source maps or TypeScript.
   Production packages in `node_modules` keep the files they publish,
   which include some `.map` and `.d.ts` files.
10. It prints the image size and startup memory as measurements, not limits.

A refused `serve` still leaves an empty database file behind: opening
SQLite creates it before the migration check runs. It has no tables, and
`migrate` uses it normally.
