#!/usr/bin/env bash
# Local test of deploy/grampacker-deploy-ssh, the deploy key's forced command.
# It never connects to the VPS, never runs sudo and never deploys: it tests a
# copy whose sudo, grampacker-deploy and log directory point at fakes in a
# temporary directory. Needs Linux (bash, GNU tail, util-linux setsid); runs
# as any user.
#
#   deploy/test-grampacker-deploy-ssh.sh
#
# Prints one line per case and exits non-zero if any case fails.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
FAKE="$WORK/bin"
mkdir -p "$FAKE" "$WORK/log"
CALLS="$WORK/calls"
COPY="$WORK/grampacker-deploy-ssh"

# Each line that names a real path or user is replaced. A replacement that
# matches nothing would test the real paths, so it stops the test.
replace() {
  local from="$1" to="$2"
  grep -qxF "$from" "$COPY" || { echo "FAIL  the wrapper has no line: $from"; exit 1; }
  local tmp="$COPY.tmp"
  awk -v from="$from" -v to="$to" '$0 == from { print to; next } { print }' "$COPY" >"$tmp"
  mv "$tmp" "$COPY"
}
cp "$HERE/grampacker-deploy-ssh" "$COPY"
replace 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' "PATH=$FAKE:/usr/bin:/bin"
replace 'SUDO=/usr/bin/sudo' "SUDO=$FAKE/sudo"
replace 'SELF=/usr/local/sbin/grampacker-deploy-ssh' "SELF=$COPY"
replace 'DEPLOY=/usr/local/sbin/grampacker-deploy' "DEPLOY=$FAKE/grampacker-deploy"
replace 'LOG_DIR=/var/log/grampacker-deploy' "LOG_DIR=$WORK/log"
# The copy runs as the current user; the test stands in for sudo's root.
# shellcheck disable=SC2016 # the line is matched literally, not expanded
replace '[ "$(id -u)" = 0 ] || die "the digest form runs only as root, through sudo"' ': root check replaced by the test'
chmod 0755 "$COPY"
if grep -v '^ *#' "$COPY" | grep -nE '/usr/bin/sudo|/usr/local/sbin|/var/log'; then
  echo "FAIL  the test copy still names a real path"; exit 1
fi

# Fake sudo: records its arguments, checks the form the wrapper must use,
# and runs the command with an empty environment, as sudo's env_reset would.
cat >"$FAKE/sudo" <<EOF
#!/usr/bin/env bash
printf 'sudo %s\n' "\$*" >>"$CALLS"
[ "\$1" = -n ] && [ "\$2" = "$COPY" ] || { echo "fake sudo: unexpected call" >&2; exit 99; }
shift
exec env -i "\$@"
EOF
# Fake grampacker-deploy: records its arguments, prints a line, and exits with
# FAKE_EXIT from a file (the environment is cleared on the way).
cat >"$FAKE/grampacker-deploy" <<EOF
#!/usr/bin/env bash
printf 'grampacker-deploy %s\n' "\$*" >>"$CALLS"
echo "fake deploy output"
exit "\$(cat "$WORK/exit")"
EOF
chmod 0755 "$FAKE/sudo" "$FAKE/grampacker-deploy"

D="$(printf 'a%.0s' {1..32})$(printf '0%.0s' {1..16})$(printf '9f%.0s' {1..8})"
GOOD="sha256:$D"
[[ "$GOOD" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "FAIL  test digest is malformed"; exit 1; }

failures=0
pass() { printf 'ok    %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; failures=$((failures + 1)); }

# Runs the wrapper as sshd would: no arguments, the request in
# SSH_ORIGINAL_COMMAND (unset when $2 is the word UNSET).
run_ssh() {
  : >"$CALLS"
  set +e
  if [ "$2" = UNSET ]; then
    out="$(env -u SSH_ORIGINAL_COMMAND "$COPY" 2>&1)"
  else
    out="$(SSH_ORIGINAL_COMMAND="$2" "$COPY" 2>&1)"
  fi
  code=$?
  set -e
}

expect_refused() {
  run_ssh "$1" "$2"
  if [ "$code" = 2 ] && [ ! -s "$CALLS" ] && [[ "$out" == *refused* ]]; then
    pass "refused: $1"
  else
    fail "refused: $1 (exit $code, calls: $(tr '\n' ';' <"$CALLS"))"
  fi
}

expect_deployed() {
  local want_exit="$3"
  echo "$want_exit" >"$WORK/exit"
  run_ssh "$1" "$2"
  local want_calls
  want_calls="$(printf 'sudo -n %s %s\ngrampacker-deploy deploy %s' "$COPY" "$GOOD" "$GOOD")"
  if [ "$code" = "$want_exit" ] && [ "$(cat "$CALLS")" = "$want_calls" ] &&
    [[ "$out" == *"fake deploy output"* ]] &&
    [[ "$out" == *"grampacker-deploy-ssh: exit $want_exit"* ]]; then
    pass "accepted: $1"
  else
    fail "accepted: $1 (exit $code, calls: $(tr '\n' ';' <"$CALLS"), output: $out)"
  fi
}

expect_deployed "the exact request" "deploy $GOOD" 0
expect_deployed "a failing deploy keeps its exit status" "deploy $GOOD" 3
if ls "$WORK/log"/*.log >/dev/null 2>&1; then
  pass "the deploy output is kept in a log file"
else
  fail "the deploy output is kept in a log file"
fi

H63="${D:0:63}"
UPPER="$(printf '%s' "$D" | tr 'a-f' 'A-F')"
expect_refused "no command (an interactive login)" UNSET
expect_refused "an empty command" ""
expect_refused "deploy with no digest" "deploy"
expect_refused "a bare digest" "$GOOD"
expect_refused "63 hex characters" "deploy sha256:$H63"
expect_refused "65 hex characters" "deploy ${GOOD}0"
expect_refused "uppercase hex" "deploy sha256:$UPPER"
expect_refused "a non-ASCII digit" "deploy sha256:${H63}٣"
expect_refused "sha512" "deploy sha512:$D"
expect_refused "an image tag" "deploy ghcr.io/joes703/grampacker:latest"
expect_refused "a commit SHA as a tag" "deploy ${D:0:40}"
expect_refused "a full image reference" "deploy ghcr.io/joes703/grampacker@$GOOD"
expect_refused "two spaces" "deploy  $GOOD"
expect_refused "a tab" "deploy	$GOOD"
expect_refused "a leading space" " deploy $GOOD"
expect_refused "a trailing space" "deploy $GOOD "
expect_refused "a trailing newline" "deploy $GOOD"$'\n'
expect_refused "a second line" "deploy $GOOD"$'\n'"maintenance off"
expect_refused "a chained command" "deploy $GOOD; id"
expect_refused "a chained command with &&" "deploy $GOOD && grampacker-deploy rollback /srv/grampacker/rollback/x"
expect_refused "command substitution" "deploy sha256:\$(id)"
expect_refused "uppercase DEPLOY" "DEPLOY $GOOD"
expect_refused "rollback" "rollback /srv/grampacker/rollback/20261015T120000Z"
expect_refused "maintenance off" "maintenance off"
expect_refused "caddy-update" "caddy-update"
expect_refused "a shell" "bash"
expect_refused "scp upload" "scp -t /tmp"
expect_refused "sftp" "/usr/lib/openssh/sftp-server"
expect_refused "the wrapper's own root form" "$COPY $GOOD"

# The root step, reached only through sudo: it checks the digest again.
root_refused() {
  local name="$1"
  shift
  : >"$CALLS"
  set +e
  out="$(env -i "$COPY" "$@" 2>&1)"
  code=$?
  set -e
  if [ "$code" = 2 ] && [ ! -s "$CALLS" ]; then
    pass "root step refused: $name"
  else
    fail "root step refused: $name (exit $code, calls: $(tr '\n' ';' <"$CALLS"))"
  fi
}
root_refused "a tag" "ghcr.io/joes703/grampacker:latest"
root_refused "63 hex characters" "sha256:$H63"
root_refused "a digest with a trailing newline" "$GOOD"$'\n'
root_refused "two arguments" "$GOOD" "$GOOD"
root_refused "a subcommand" rollback /srv/grampacker/rollback/x
root_refused "deploy plus digest" deploy "$GOOD"

if [ "$failures" = 0 ]; then
  echo "all cases passed"
else
  echo "$failures case(s) failed"
  exit 1
fi
