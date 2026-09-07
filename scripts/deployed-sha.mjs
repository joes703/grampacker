#!/usr/bin/env node
// @ts-check
// Reports what the production deployment records say about production, and how
// far that can be trusted. Prints one line: `<state>\t<sha>`.
//
//   current      the newest marker succeeded and its SHA is main's head
//   behind       the newest marker succeeded and its SHA is NOT main's head
//                (different, not provably an ancestor - nothing here walks
//                history)
//   unverified   the newest marker has no status, or its latest status is not
//                a success - production state cannot be established
//   no-marker    there are no production deployment records at all
//
// WHY NOT `deployments | .[0].sha`, which this replaces
// -----------------------------------------------------
// deploy.yml's "Record deployment marker" step creates the deployment record
// FIRST and posts its `success` status SECOND, in two separate API calls, and
// it explicitly survives the status POST failing. So "a record exists" and
// "that SHA was recorded as deployed" are different claims, and only the
// second one is evidence.
//
// A deployment's current state is its LATEST status, not any success anywhere
// in its history: a record whose latest status is `inactive` does not
// establish the live deployment, even though its history contains a success.
//
// ONLY THE NEWEST RECORD IS CONSULTED
// -----------------------------------
// When the newest marker is incomplete or unsuccessful, an OLDER success does
// not prove what production is running - the newer deploy may have changed
// production and then failed to record itself, which is exactly what
// deploy.yml warns about. Falling back would state a deployed SHA on evidence
// that does not support it. `unverified` says what is actually known.
//
// TIES ARE NOT BROKEN ARBITRARILY
// -------------------------------
// GitHub timestamps have second resolution, so two records can share the
// newest `created_at`. Sorting and taking the first would then decide the
// answer by whichever order the API happened to return - `[inactive, success]`
// and `[success, inactive]` would disagree. So: ANY tie among deployments is
// `ambiguous` (their statuses are not even consulted - a tie means "which is
// newest" is unanswerable, whatever the statuses say), and a tie among the
// newest statuses is `ambiguous` unless they all agree.
//
// `ambiguous` is not a success, so it surfaces as `unverified` - and the SHA
// reported alongside it is then only ONE of the tied records. The caller's
// wording must not claim otherwise.
//
// BOUNDS, STATED
// --------------
// At most two requests: one page of deployments, then the newest record's
// statuses (an empty first page needs no second request). The sort establishes
// the newest record WITHIN THE PAGE THE API RETURNED; which records it returns
// is its choice. Neither endpoint documents a newest-first guarantee, which is
// why the order is not trusted; GitHub's UTC ISO-8601 timestamps sort
// lexicographically.
//
// Any `gh` failure throws and exits non-zero; the caller runs under
// `set -euo pipefail`, so the check stops rather than guessing.
//
// Usage: node scripts/deployed-sha.mjs <main-head-sha>

import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every record sharing the newest `created_at` - one when nothing ties, none
 * when there are no records.
 * @template {{ created_at: string }} T
 * @param {T[]} records
 * @returns {T[]}
 */
const newestGroup = (records) => {
  const newest = records.map((record) => record.created_at).sort().at(-1)
  return records.filter((record) => record.created_at === newest)
}

// The fields this reads. The API returns many more.
/** @typedef {{ id: number, sha: string, created_at: string }} Deployment */
/** @typedef {{ state: string, created_at: string }} DeploymentStatus */

/**
 * The newest production deployment record and the state of its latest status:
 * `none` when it has no status, `ambiguous` when the newest records or
 * statuses tie without agreeing. Null when there are no records.
 * @param {(path: string) => Promise<any>} api a repo-relative GitHub API GET
 * @returns {Promise<{ sha: string, state: string } | null>}
 */
export const latestMarker = async (api) => {
  /** @type {Deployment[]} */
  const records = await api('deployments?environment=production&per_page=100')
  const [deployment, ...tied] = newestGroup(records)
  if (deployment === undefined) return null
  // More than one record at the newest timestamp: which is actually newest is
  // not decidable from the data, and reading just the first one's statuses
  // would let the API's return order pick the answer - two records for the
  // SAME SHA, one successful and one failed, would flip between `current` and
  // `unverified` on order alone. Comparing SHAs is not enough to catch that.
  if (tied.length > 0) return { sha: deployment.sha, state: 'ambiguous' }
  /** @type {DeploymentStatus[]} */
  const history = await api(`deployments/${deployment.id}/statuses?per_page=100`)
  const statuses = newestGroup(history)
  const [status] = statuses
  const agreed = status !== undefined && statuses.every((other) => other.state === status.state)
  return {
    sha: deployment.sha,
    state: status === undefined ? 'none' : agreed ? status.state : 'ambiguous',
  }
}

/**
 * @param {string} headSha main's head
 * @param {{ sha: string, state: string } | null} marker
 * @returns {{ state: string, sha: string }}
 */
export const liveness = (headSha, marker) => {
  if (marker === null) return { state: 'no-marker', sha: '' }
  if (marker.state !== 'success') return { state: 'unverified', sha: marker.sha }
  return { state: marker.sha === headSha ? 'current' : 'behind', sha: marker.sha }
}

// Only when run as a program: the test imports this module.
const entry = process.argv[1]
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  const [headSha] = process.argv.slice(2)
  if (headSha === undefined || headSha === '') {
    console.error('usage: node scripts/deployed-sha.mjs <main-head-sha>')
    process.exit(1)
  }
  const repo = process.env.GITHUB_REPOSITORY
  const marker = await latestMarker(async (path) =>
    JSON.parse(
      execFileSync('gh', ['api', `repos/${repo}/${path}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf8'),
    ),
  )
  const { state, sha } = liveness(headSha, marker)
  console.log(`${state}\t${sha}`)
}
