import { readFileSync } from 'node:fs'

const lockfilePath = process.argv[2] ?? new URL('../package-lock.json', import.meta.url)
const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'))
const packages = lockfile.packages

if (!packages || typeof packages !== 'object') {
  throw new Error('Lockfile source check failed: package-lock.json has no packages map.')
}

const allowedOrigin = 'https://registry.npmjs.org'
const offenders = []
let checked = 0

for (const [path, metadata] of Object.entries(packages)) {
  if (!metadata || path === '') continue

  if (metadata.link === true) {
    offenders.push({ path, resolved: '(directory link)' })
    continue
  }

  if (typeof metadata.resolved !== 'string') continue
  checked += 1

  let resolved
  try {
    resolved = new URL(metadata.resolved)
  } catch {
    offenders.push({ path, resolved: metadata.resolved })
    continue
  }

  if (resolved.protocol !== 'https:' || resolved.origin !== allowedOrigin) {
    offenders.push({ path, resolved: metadata.resolved })
  }
}

if (offenders.length > 0) {
  console.error('Lockfile source check failed: dependencies must resolve from the npm registry.')
  for (const offender of offenders) {
    console.error(`- ${offender.path}: ${offender.resolved}`)
  }
  process.exit(1)
}

if (checked === 0) {
  throw new Error('Lockfile source check failed: no resolved package sources were inspected.')
}

console.log(`Lockfile source check passed (${checked} registry packages).`)
