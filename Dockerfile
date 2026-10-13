# The production image: one Node process serving the API and the built SPA
# from a SQLite database in /data (docs/vps-migration-plan.md step 5).
#
#   docker build --platform linux/amd64 -t grampacker .
#   docker run --rm -v "$PWD/data:/data" grampacker migrate   apply migrations
#   docker run -d -v "$PWD/data:/data" --env-file app.env grampacker   serve
#
# Migrating and serving are separate commands on purpose. `serve` (the
# default) never changes the schema: it refuses to start while a migration
# is pending, so the deploy runs `migrate` explicitly, after a snapshot.
#
# The base image is pinned by version AND digest, and every stage uses the
# same one. Build and runtime must share a C library: better-sqlite3 loads a
# prebuilt glibc binary from its npm package (prebuilds/linux-x64.node), so
# no compiler is needed and Alpine (musl) is not used.
#
# Node 24.21.0, Debian 13 (trixie), glibc 2.41. The digest is the
# multi-platform index; its linux/amd64 manifest is sha256:c83040f7e24b...
# (docs/container-image.md says how it was chosen and how to update it).
ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:173f125896c3b47ddf056734c7ea789d04595a6a08769a8f78e0df642781fb66

# 1. Build: every dependency, then the SPA and the compiled server. Not
#    `npm run build`: that also runs the Cloudflare build, which copies
#    .dev.vars into dist/. Typecheck, lint and tests run in CI, not here.
FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build:client && npm run build:server

# 2. Production dependencies only. .npmrc keeps ignore-scripts, so no
#    package runs an install script.
#
#    --omit=dev alone is not enough. better-auth names vitest, drizzle-kit
#    and others as OPTIONAL peer dependencies, so the lockfile marks them
#    devOptional and --omit=dev keeps them. No production package requires an
#    optional package (docs/container-image.md), so --omit=optional removes
#    them. scripts/check-image.sh fails if a dev tool is present.
FROM ${NODE_IMAGE} AS deps
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --omit=optional

# 3. Runtime: only what `node dist/server/node.js` reads.
FROM ${NODE_IMAGE} AS runtime

# npm, npx and corepack are not used at runtime; removing them removes their
# code and their advisories from the image. The app user has a fixed numeric
# UID/GID because the host's bind-mounted data directory is owned by that
# number (docs/container-image.md). It is not 1000, so it never matches an
# ordinary login user on the host. /data exists for a run without a mount.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin app \
 && install -d -o app -g app -m 0700 /data

WORKDIR /app

# The server reads migrations/ and dist/client relative to /app. Root owns
# every file here, so the app user cannot change its own code.
#
# NODE_ENV=production changes one thing this app can see: better-auth's
# /api/auth/error redirects to /?error=... instead of serving its own HTML
# page. Its rate limiter is off in server/auth.ts, and the https base URL,
# not NODE_ENV, chooses the secure cookie names.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/grampacker.db \
    STATIC_DIR=/app/dist/client

# package.json is read at runtime: its "type": "module" makes Node load
# dist/server/*.js as ES modules. The migration runner needs only the SQL
# files and the journal, not Drizzle's snapshots.
COPY package.json ./
COPY --from=deps /src/node_modules ./node_modules
COPY migrations/*.sql ./migrations/
COPY migrations/meta/_journal.json ./migrations/meta/
COPY --from=build /src/dist/server ./dist/server
COPY --from=build /src/dist/client ./dist/client

USER 10001:10001
EXPOSE 3000

# HTTP 200 AND a JSON body whose ok is exactly true, within 3 s
# (server/healthcheck.ts). Docker's own timeout is longer so the script's
# reason, not a kill, is what `docker inspect` shows.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/app/dist/server/healthcheck.js"]

# Node is PID 1 and handles SIGTERM itself: it stops accepting requests,
# lets in-flight ones finish, closes SQLite, then exits 0 (server/node.ts).
ENTRYPOINT ["node", "/app/dist/server/node.js"]
CMD ["serve"]
