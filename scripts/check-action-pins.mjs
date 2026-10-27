// @ts-check
// Checks that every remote GitHub Action is pinned to a full commit SHA with a
// trailing `# <tag>` comment. A tag is mutable, so the SHA is the security
// property; the comment tells a reader which release the SHA is.
//
// This check is offline. It does not ask GitHub whether the comment matches
// the SHA: review Dependabot's pin comments by eye.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const WORKFLOWS_DIR = '.github/workflows'

// `uses: owner/repo@ref` or `owner/repo/subpath@ref`, with whatever trails it.
// Loose on the ref, so a tag-pinned action is caught below rather than skipped.
// YAML allows a quoted value; a checker that skips `uses: "owner/repo@v4"`
// would let the tag pin through.
const USES = /^\s*(?:-\s*)?uses:\s*(?<quote>['"]?)(?<action>[^@\s'"]+)@(?<ref>[^\s'"#]+)\k<quote>\s*(?<trailer>#.*)?$/

/** @param {string} line @returns {{ action: string, ref: string, trailer: string } | null} */
export const parseUses = (line) => {
  const match = USES.exec(line)
  if (!match) return null
  const { action, ref, trailer } = /** @type {Record<string, string | undefined>} */ (match.groups ?? {})
  if (!action || !ref) return null
  // Local actions and docker:// refs have no upstream tag; not guarded here.
  if (action.startsWith('./') || action.startsWith('docker://')) return null
  return { action, ref, trailer: trailer?.trim() ?? '' }
}

/** @param {{ action: string, ref: string, trailer: string }} pin @returns {string | null} */
export const pinProblem = (pin) => {
  if (!/^[0-9a-f]{40}$/.test(pin.ref)) {
    return `${pin.action} is pinned to "${pin.ref}", not a full 40-character commit SHA.`
  }
  if (!/^#\s*\S+/.test(pin.trailer)) {
    return `${pin.action} has no trailing "# <tag>" comment saying what the SHA is.`
  }
  return null
}

const main = () => {
  /** @type {string[]} */
  const problems = []
  let count = 0
  for (const file of readdirSync(WORKFLOWS_DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const path = join(WORKFLOWS_DIR, file)
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        const pin = parseUses(line)
        if (!pin) return
        count++
        const problem = pinProblem(pin)
        if (problem) problems.push(`${path}:${index + 1}: ${problem}`)
      })
  }
  if (count === 0) throw new Error(`No action pins found under ${WORKFLOWS_DIR}. Check the parser.`)
  if (problems.length > 0) {
    console.error(`\nAction pin check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`)
    process.exit(1)
  }
  console.log(`Action pins: ${count} pinned to a full SHA with a tag comment.`)
}

// Run only when invoked as a script; the test imports the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
