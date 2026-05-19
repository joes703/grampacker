#!/bin/sh
set -eu

# Fast, repo-local checks for high-signal npm supply-chain IOCs seen in the
# May 2026 Mini Shai-Hulud waves. This is intentionally narrow: it catches
# patterns that should not appear in grampacker at all, while npm audit covers
# known vulnerability advisories.

patterns='
@antv/
@antv/setup
github:antvis/G2
size-sensor
echarts-for-react
timeago.js
timeago-react
jest-canvas-mock
jest-date-mock
bun run index.js
t.m-kosche
m-kosche
/api/public/otel/v1/traces
firedalazer
kitty-monitor
gh-token-monitor
com.user.kitty-monitor
'

files='package.json package-lock.json'

if grep -E -n "$(
  printf '%s\n' "$patterns" |
    sed '/^$/d' |
    sed 's/[.[\*^$()+?{}|\\]/\\&/g' |
    paste -sd '|' -
)" $files >/tmp/grampacker-supply-chain-iocs.$$ 2>/dev/null; then
  cat /tmp/grampacker-supply-chain-iocs.$$
  rm -f /tmp/grampacker-supply-chain-iocs.$$
  echo "Supply-chain IOC check failed: suspicious dependency or payload marker found." >&2
  exit 1
fi
rm -f /tmp/grampacker-supply-chain-iocs.$$

if find . \
  -path './node_modules' -prune -o \
  -path './dist' -prune -o \
  -path './.git' -prune -o \
  \( -path './.claude/setup.mjs' -o -path './.vscode/setup.mjs' -o -path './.vscode/tasks.json' \) \
  -print | grep .; then
  echo "Supply-chain IOC check failed: suspicious repo-local agent/editor hook file found." >&2
  exit 1
fi

echo "Supply-chain IOC check passed."
