// @ts-check
// Verifies that every GitHub Action pinned by commit SHA actually points at the
// release its trailing comment claims.
//
// WHY THIS EXISTS
// ---------------
// We pin actions by full commit SHA because a tag is mutable - `v7` can be
// repointed at anything later. The SHA is the security property. But a 40-hex
// string tells a human nothing, so every pin carries a trailing `# v7.0.0`
// comment, and THAT is what anyone reading the workflow actually believes.
//
// Nothing was checking it. Dependabot moves the SHA and leaves the comment
// alone, so PR #154 proposed the correct v7.0.0 hash still labeled `# v6`.
// Had it merged as authored, the workflows would have read `# v6` while running
// v7 - the pin would have been right and the repo's only human-readable record
// of it wrong. A comment that can lie is worse than no comment, because it is
// trusted.
//
// WHAT IT ENFORCES
// ----------------
//   * every `uses:` on a remote action is a full 40-hex commit SHA, never a tag
//     or branch
//   * every pin carries a trailing `# <tag>` comment
//   * that tag exists upstream and resolves to exactly the pinned SHA
//
// FAIL-CLOSED, INCLUDING ON NETWORK FAILURE
// -----------------------------------------
// A check that passes when it cannot reach the API is not a check - it would go
// green for the one reason it was never able to look. Unreachable API, rate
// limit, unknown tag: all hard failures. The trade is that this step needs
// network, which is why it retries before giving up.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const WORKFLOWS_DIR = '.github/workflows'
const API = 'https://api.github.com'
const RETRIES = 3

// `uses: owner/repo@ref` or `owner/repo/subpath@ref`, with whatever trails it.
// Deliberately loose on the ref so a tag-pinned action is CAUGHT below rather
// than skipped by a regex that only recognizes SHAs. YAML allows the value to
// be quoted, so an optional matching quote pair is accepted too - a checker
// that skips `uses: "owner/repo@v4"` silently waves the tag pin through.
const USES = /^\s*(?:-\s*)?uses:\s*(?<quote>['"]?)(?<action>[^@\s'"]+)@(?<ref>[^\s'"#]+)\k<quote>\s*(?<trailer>#.*)?$/

// One workflow line -> its pin, or null for a line this check does not guard.
// Exported for the unit test; the network checks below stay untested.
/** @param {string} line @returns {{ action: string, ref: string, trailer: string } | null} */
export const parseUses = (line) => {
  const match = USES.exec(line)
  if (!match) return null
  const { action, ref, trailer } = /** @type {Record<string, string | undefined>} */ (match.groups ?? {})
  if (!action || !ref) return null
  // A local action (`./.github/actions/x`) or a docker:// ref has no
  // upstream tag to resolve and is not what this guards.
  if (action.startsWith('./') || action.startsWith('docker://')) return null
  return { action, ref, trailer: trailer?.trim() ?? '' }
}

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The two GitHub endpoints used below both answer with this shape.
/** @typedef {{ object?: { type?: string, sha?: string } }} GitRef */

/** @param {string} path @returns {Promise<GitRef | null>} */
const api = async (path) => {
  let lastError
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(`${API}${path}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'grampacker-action-pin-check',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      })
      // 404 is a real answer - the tag does not exist. Do not burn retries on it.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return /** @type {GitRef} */ (await response.json())
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) await sleep(attempt * 500)
    }
  }
  throw new Error(`GitHub API request failed after ${RETRIES} attempts: ${path} (${lastError})`)
}

// Tags come in two shapes. A lightweight tag's ref points straight at the
// commit; an annotated tag's ref points at a tag OBJECT that in turn points at
// the commit. Comparing a pinned commit SHA against an annotated tag's own SHA
// would fail every time, for no real reason.
/** @param {string} action @param {string} tag */
const commitForTag = async (action, tag) => {
  const ref = await api(`/repos/${action}/git/ref/tags/${encodeURIComponent(tag)}`)
  if (!ref) return null
  if (ref.object?.type === 'commit') return ref.object.sha
  if (ref.object?.type === 'tag') {
    const annotated = await api(`/repos/${action}/git/tags/${ref.object.sha}`)
    return annotated?.object?.sha ?? null
  }
  return null
}

const collectPins = () => {
  /** @type {Array<{ where: string, action: string, ref: string, trailer: string }>} */
  const pins = []
  for (const file of readdirSync(WORKFLOWS_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const path = join(WORKFLOWS_DIR, file)
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const pin = parseUses(line)
        if (!pin) return
        pins.push({ where: `${path}:${index + 1}`, ...pin })
      })
  }
  return pins
}

const main = async () => {
  const pins = collectPins()
  if (pins.length === 0) throw new Error(`No action pins found under ${WORKFLOWS_DIR}. Check the parser.`)

  const problems = []
  // Several workflows pin the same action at the same SHA; resolve each
  // (action, tag) pair once rather than per call site.
  const resolved = new Map()

  for (const pin of pins) {
    if (!/^[0-9a-f]{40}$/.test(pin.ref)) {
      problems.push(`${pin.where}: ${pin.action} is pinned to "${pin.ref}", not a full 40-character commit SHA.`)
      continue
    }

    const tag = /^#\s*(\S+)/.exec(pin.trailer)?.[1]
    if (!tag) {
      problems.push(`${pin.where}: ${pin.action} has no trailing "# <tag>" comment saying what the SHA is.`)
      continue
    }

    const key = `${pin.action}@${tag}`
    if (!resolved.has(key)) resolved.set(key, await commitForTag(pin.action, tag))
    const expected = resolved.get(key)

    if (expected === null) {
      problems.push(`${pin.where}: ${pin.action} claims tag "${tag}", which does not exist upstream.`)
    } else if (expected !== pin.ref) {
      problems.push(
        `${pin.where}: ${pin.action} is pinned to ${pin.ref} but its comment says "${tag}", which is ${expected}.`,
      )
    } else {
      console.log(`  ok  ${pin.where}  ${pin.action}@${tag}`)
    }
  }

  if (problems.length > 0) {
    console.error(`\nAction pin check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`)
    process.exit(1)
  }
  console.log(`\nAction pins: ${pins.length} verified against upstream tags.`)
}

// Run only when invoked as a script; the test imports parseUses and must not
// trigger the network checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
