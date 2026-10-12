#!/usr/bin/env bash
# Tests a built production image as a container, not the host process:
#
#   docker build --platform linux/amd64 -t grampacker:check .
#   scripts/check-image.sh grampacker:check
#
# Needs only Docker, curl and timeout (coreutils). It uses a throwaway data
# directory and a throwaway configuration (no real secret, no email key, no
# network calls out), removes every container it starts, and stops at the
# first failure with a non-zero exit. Image size and startup memory are printed as
# measurements, not checked against limits.
set -euo pipefail

IMAGE="${1:?usage: scripts/check-image.sh <image>}"
APP_ID=10001
WORK="$(mktemp -d)"
DATA="$WORK/data"
NAME="grampacker-check-$$"
CONTAINERS=()

pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*" >&2; exit 1; }
note() { printf 'INFO  %s\n' "$*"; }

cleanup() {
  for c in "${CONTAINERS[@]}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  # The data files belong to the app's UID; remove them from inside Docker so
  # the host needs no sudo.
  if [ -d "$WORK" ]; then
    docker run --rm --user 0 --entrypoint rm -v "$WORK:/work" "$IMAGE" -rf /work/data /work/locked >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

# Throwaway configuration. The secret is random per run and never printed.
ENV_FILE="$WORK/app.env"
{
  echo "BETTER_AUTH_URL=https://grampacker.example"
  echo "BETTER_AUTH_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n/+=')"
} >"$ENV_FILE"

# Runs a one-off container as the image's user with the data directory.
run_app() { docker run --rm --env-file "$ENV_FILE" -v "$DATA:/data" "$IMAGE" "$@"; }

# Runs node inside the image with SQLite, for inspecting the database file.
sql() {
  docker run --rm -v "$DATA:/data" --entrypoint node "$IMAGE" --input-type=module -e "
    import Database from 'better-sqlite3'
    const db = new Database('/data/grampacker.db', { readonly: true, fileMustExist: true })
    console.log(JSON.stringify(db.prepare(process.argv[1]).all()))
  " "$1"
}

start_server() {
  local name="$1"
  # As production runs it (runbook compose.yaml): read-only root filesystem,
  # a tmpfs /tmp, the data directory mounted, the port on loopback only.
  docker run -d --name "$name" --env-file "$ENV_FILE" -v "$DATA:/data" \
    --read-only --tmpfs /tmp -p 127.0.0.1::3000 "$IMAGE" >/dev/null
  CONTAINERS+=("$name")
  local status=""
  for _ in $(seq 1 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$name")"
    [ "$status" = healthy ] && break
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || break
    sleep 1
  done
  [ "$status" = healthy ] || { docker logs "$name" >&2; fail "$name did not become healthy (status: $status)"; }
  BASE="http://$(docker port "$name" 3000/tcp | head -n 1)"
}

# --- 1. Platform -----------------------------------------------------------
platform="$(docker image inspect -f '{{.Os}}/{{.Architecture}}' "$IMAGE")"
[ "$platform" = linux/amd64 ] || fail "platform is $platform, expected linux/amd64"
pass "platform linux/amd64"

# --- 2. Non-root -----------------------------------------------------------
user="$(docker image inspect -f '{{.Config.User}}' "$IMAGE")"
[ "$user" = "$APP_ID:$APP_ID" ] || fail "image USER is '$user', expected $APP_ID:$APP_ID"
ids="$(docker run --rm --entrypoint id "$IMAGE")"
case "$ids" in
  "uid=$APP_ID(app) gid=$APP_ID(app) groups=$APP_ID(app)") pass "runs as non-root: $ids" ;;
  *) fail "runs as: $ids" ;;
esac

# --- 3. An unmigrated database refuses to start, and nothing is created ----
mkdir -p "$DATA"
docker run --rm --user 0 --entrypoint sh -v "$DATA:/data" "$IMAGE" \
  -c "chown $APP_ID:$APP_ID /data && chmod 0700 /data"
# Detached with a deadline: an image that wrongly serves an unmigrated
# database would otherwise keep this check waiting forever.
docker run -d --name "$NAME-unmigrated" --env-file "$ENV_FILE" -v "$DATA:/data" "$IMAGE" >/dev/null
CONTAINERS+=("$NAME-unmigrated")
code="$(timeout 30 docker wait "$NAME-unmigrated" || true)"
[ -n "$code" ] || fail "serve on an unmigrated database did not exit within 30 s (or docker wait failed)"
out="$(docker logs "$NAME-unmigrated" 2>&1)"
[ "$code" = 1 ] || fail "serve on an empty database exited $code, expected 1: $out"
case "$out" in *"not applied"*"run the migrate command first"*) ;; *) fail "unexpected refusal: $out" ;; esac
tables="$(sql "select name from sqlite_schema")"
[ "$tables" = "[]" ] || fail "the refused start created schema: $tables"
pass "unmigrated database refuses to start (exit 1) and gains no schema"

# A data directory the app user cannot write fails loudly, not silently.
mkdir -p "$WORK/locked"
set +e
out="$(docker run --rm --env-file "$ENV_FILE" -v "$WORK/locked:/data" "$IMAGE" migrate 2>&1)"
code=$?
set -e
[ "$code" != 0 ] || fail "migrate into an unwritable directory succeeded"
pass "migrate into a directory the app user cannot write exits $code"

# --- 4. The explicit migrate command ---------------------------------------
out="$(run_app migrate)"
case "$out" in "applied "[1-9]*" migration(s) to /data/grampacker.db") ;; *) fail "migrate printed: $out" ;; esac
pass "migrate: $out"
out="$(run_app migrate)"
[ "$out" = "applied 0 migration(s) to /data/grampacker.db" ] || fail "second migrate printed: $out"
pass "migrate again is a no-op: $out"

# --- 5 and 6. Serve the migrated database over HTTP -------------------------
start_server "$NAME-a"
pass "server healthy by its own HEALTHCHECK (read-only root filesystem)"
note "startup memory: $(docker stats --no-stream --format '{{.MemUsage}}' "$NAME-a")"

body="$(curl -sS -o - -w '\n%{http_code}' "$BASE/api/health")"
[ "$body" = $'{"ok":true}\n200' ] || fail "health: $body"
pass "GET /api/health -> 200 {\"ok\":true}"

shell="$(curl -sS -D "$WORK/shell.h" "$BASE/")"
grep -qi '^content-type: text/html' "$WORK/shell.h" || fail "shell is not HTML"
grep -q '<div id="root">' <<<"$shell" || fail "shell has no #root"
pass "GET / -> SPA shell"

deep="$(curl -sS -w '\n%{http_code}' "$BASE/lists/does-not-exist/food")"
[ "$deep" = "$shell"$'\n200' ] || fail "deep link did not return the shell"
pass "GET /lists/does-not-exist/food -> 200, the same shell"

asset="$(grep -oE '/assets/[^"]+\.js' <<<"$shell" | head -n 1)"
[ -n "$asset" ] || fail "no script asset in the shell"
curl -sS -o /dev/null -D "$WORK/asset.h" "$BASE$asset"
grep -q '^HTTP/1.1 200' "$WORK/asset.h" || fail "$asset: $(head -n 1 "$WORK/asset.h")"
grep -qi '^content-type: text/javascript' "$WORK/asset.h" || fail "$asset is not JavaScript"
grep -qi '^cache-control: public, max-age=31536000, immutable' "$WORK/asset.h" || fail "$asset is not cached as immutable"
pass "GET $asset -> 200 JavaScript, immutable"

code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/assets/missing-0000.js")"
[ "$code" = 404 ] || fail "missing asset -> $code"
pass "GET /assets/missing-0000.js -> 404"

nf="$(curl -sS -w '\n%{http_code}' "$BASE/api/no-such-route")"
[ "$nf" = $'{"error":"Not found"}\n404' ] || fail "API 404: $nf"
pass "GET /api/no-such-route -> 404 JSON"

# --- 7. Data survives replacing the container ------------------------------
# Exhaust one sign-in rate-limit bucket (10 per 10 minutes). The count lives
# in SQLite, so a new container on the same data must still refuse.
signin() {
  curl -sS -o /dev/null -w '%{http_code}' -H 'X-Forwarded-For: 192.0.2.77' "$BASE/api/auth/sign-in/check-image"
}
for _ in $(seq 1 10); do [ "$(signin)" != 429 ] || fail "refused before the limit"; done
[ "$(signin)" = 429 ] || fail "11th sign-in request was not refused"
pass "10 sign-in requests pass, the 11th is 429"

# --- 8. SIGTERM: graceful exit ----------------------------------------------
started="$(date +%s)"
docker stop -t 20 "$NAME-a" >/dev/null
took=$(( $(date +%s) - started ))
code="$(docker inspect -f '{{.State.ExitCode}}' "$NAME-a")"
[ "$code" = 0 ] || fail "exit code after SIGTERM: $code"
logs="$(docker logs "$NAME-a" 2>&1)"
grep -q 'SIGTERM: shutting down' <<<"$logs" || fail "no shutdown log line"
grep -q 'shutdown complete' <<<"$logs" || fail "no shutdown-complete log line"
pass "SIGTERM -> exit 0 in ${took}s, logged shutdown complete"
[ -z "$(ls "$DATA" | grep -E -- '-(wal|shm)$' || true)" ] && note "no -wal/-shm left after shutdown" \
  || note "left beside the database: $(ls "$DATA" | tr '\n' ' ')"

docker rm "$NAME-a" >/dev/null
start_server "$NAME-b"
[ "$(signin)" = 429 ] || fail "the new container forgot the rate-limit count"
rows="$(sql "select count(*) as n from rate_limits")"
pass "after removing and replacing the container the bucket is still exhausted (rate_limits: $rows)"
docker stop -t 20 "$NAME-b" >/dev/null

# --- 9. Image contents -----------------------------------------------------
listing="$(docker run --rm --entrypoint sh "$IMAGE" -c 'cd /app && ls -A . dist migrations/meta')"
for want in dist migrations node_modules package.json client server _journal.json; do
  grep -qx "$want" <<<"$listing" || fail "/app is missing $want"
done
extra="$(docker run --rm --entrypoint sh "$IMAGE" -c 'cd /app && ls -A | grep -vxE "dist|migrations|node_modules|package.json" ; ls -A dist | grep -vxE "client|server"; ls -A migrations | grep -vxE "meta|[0-9]{4}_.*\.sql"; ls -A migrations/meta | grep -vx _journal.json' || true)"
[ -z "$extra" ] || fail "unexpected files in /app: $extra"
pass "/app holds only package.json, node_modules, migrations (SQL + journal), dist/server, dist/client"

# As root, so no unreadable directory hides a file or fails the search.
found="$(docker run --rm --user 0 --entrypoint sh "$IMAGE" -c '
  find / -xdev \( -path /proc -o -path /sys \) -prune -o \( \
    -name .git -o -name ".env*" -o -name ".dev.vars*" -o -name ".wrangler" -o -name "wrangler.*" \
    -o -name "*.db" -o -name "*.db-wal" -o -name "*.db-shm" -o -name "*.sqlite*" -o -name ".npmrc" \
  \) -print')"
[ -z "$found" ] || fail "forbidden files in the image: $found"
pass "no .git, .env*, .dev.vars, Wrangler files, .npmrc or SQLite files anywhere"

found="$(docker run --rm --entrypoint sh "$IMAGE" -c 'find /app/dist /app/migrations \( -name "*.map" -o -name "*.test.*" -o -name "*.ts" \) -print; ls -A /data')"
[ -z "$found" ] || fail "maps, tests, TypeScript or data in the app: $found"
pass "no source maps, tests or TypeScript in dist/migrations; /data is empty"

found="$(docker run --rm --entrypoint node "$IMAGE" -e '
  const fs = require("node:fs")
  const pkg = JSON.parse(fs.readFileSync("/app/package.json", "utf8"))
  const present = Object.keys(pkg.devDependencies).filter((n) => fs.existsSync("/app/node_modules/" + n))
  for (const n of ["vite", "vitest", "wrangler", "typescript", "eslint", "drizzle-kit", "tsx", "miniflare", "workerd", "esbuild"]) {
    if (fs.existsSync("/app/node_modules/" + n) && !present.includes(n)) present.push(n)
  }
  console.log(present.join(" "))
')"
[ -z "$found" ] || fail "development packages present: $found"
pass "no development dependency in node_modules"

found="$(docker run --rm --entrypoint sh "$IMAGE" -c 'command -v npm npx corepack yarn || true')"
[ -z "$found" ] || fail "package managers present: $found"
pass "no npm, npx, corepack or yarn"

env_keys="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$IMAGE" | cut -d= -f1 | sort | tr '\n' ' ')"
case "$env_keys" in *SECRET*|*KEY*|*TOKEN*|*PASSWORD*) fail "image ENV names a secret: $env_keys" ;; esac
pass "image ENV holds no secret: $env_keys"

# --- 10. Measurements --------------------------------------------------------
note "image size: $(docker image inspect -f '{{.Size}}' "$IMAGE") bytes"
note "node_modules: $(docker run --rm --entrypoint du "$IMAGE" -sh /app/node_modules | cut -f1)"
note "dist: $(docker run --rm --entrypoint du "$IMAGE" -sh /app/dist | cut -f1)"
echo "all image checks passed"
