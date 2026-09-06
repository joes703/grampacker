import { describe, expect, it } from 'vitest'
import { latestMarker, liveness } from './deployed-sha.mjs'

type Status = { state: string; created_at: string }
type Deployment = { id: number; sha: string; created_at: string }

const DEPLOYMENTS = 'deployments?environment=production&per_page=100'
const HEAD = 'a'.repeat(40)
const OLDER = 'b'.repeat(40)

const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T00:00:00Z`
const status = (state: string, day: number): Status => ({ state, created_at: at(day) })

/**
 * A GitHub API stub. It records every path asked for - the tests assert the
 * exact sequence, which is what pins the request count - and throws on any
 * path the script has no business requesting.
 */
const apiWith = (deployments: Deployment[], statuses: Record<number, Status[]>) => {
  const asked: string[] = []
  const api = async (path: string): Promise<unknown> => {
    asked.push(path)
    if (path === DEPLOYMENTS) return deployments
    const match = /^deployments\/(\d+)\/statuses\?per_page=100$/.exec(path)
    if (match !== null) return statuses[Number(match[1])] ?? []
    throw new Error(`unexpected api ${path}`)
  }
  return { api, asked }
}

describe('liveness', () => {
  it('reports current when the newest marker succeeded at main head', () => {
    expect(liveness(HEAD, { sha: HEAD, state: 'success' })).toEqual({ state: 'current', sha: HEAD })
  })

  it('reports behind when the newest marker succeeded at a different commit', () => {
    expect(liveness(HEAD, { sha: OLDER, state: 'success' })).toEqual({ state: 'behind', sha: OLDER })
  })

  it('reports unverified for a missing, unsuccessful or ambiguous latest status', () => {
    // deploy.yml creates the record before posting its status and survives the
    // status POST failing, so `none` is reachable - and it means the marker is
    // incomplete, NOT that an older SHA is running.
    for (const state of ['none', 'failure', 'inactive', 'error', 'in_progress', 'ambiguous']) {
      expect(liveness(HEAD, { sha: OLDER, state })).toEqual({ state: 'unverified', sha: OLDER })
    }
  })

  it('reports no-marker when there are no records at all', () => {
    expect(liveness(HEAD, null)).toEqual({ state: 'no-marker', sha: '' })
  })
})

describe('latestMarker', () => {
  it('picks the newest record and its newest status in exactly two requests', async () => {
    // Both lists are deliberately supplied oldest-first: neither endpoint
    // documents newest-first, so the script must order them itself.
    const { api, asked } = apiWith(
      [
        { id: 1, sha: OLDER, created_at: at(1) },
        { id: 2, sha: HEAD, created_at: at(2) },
      ],
      { 2: [status('in_progress', 2), status('success', 3)] },
    )
    await expect(latestMarker(api)).resolves.toEqual({ sha: HEAD, state: 'success' })
    expect(asked).toEqual([DEPLOYMENTS, 'deployments/2/statuses?per_page=100'])
  })

  it('reports state none when the newest record has no status', async () => {
    const { api } = apiWith([{ id: 2, sha: HEAD, created_at: at(2) }], {})
    await expect(latestMarker(api)).resolves.toEqual({ sha: HEAD, state: 'none' })
  })

  it('never falls back to an older success', async () => {
    const { api } = apiWith(
      [
        { id: 1, sha: OLDER, created_at: at(1) },
        { id: 2, sha: HEAD, created_at: at(2) },
      ],
      { 1: [status('success', 1)], 2: [status('failure', 2)] },
    )
    await expect(latestMarker(api)).resolves.toEqual({ sha: HEAD, state: 'failure' })
  })

  it('calls statuses ambiguous when the newest two disagree at the same second', async () => {
    // GitHub timestamps are second-resolution. Taking whichever sorted first
    // would let the API's return order decide: both orders must agree here.
    for (const pair of [
      [status('inactive', 3), status('success', 3)],
      [status('success', 3), status('inactive', 3)],
    ]) {
      const { api } = apiWith([{ id: 2, sha: HEAD, created_at: at(2) }], { 2: pair })
      await expect(latestMarker(api)).resolves.toEqual({ sha: HEAD, state: 'ambiguous' })
    }
  })

  it('accepts a tie whose statuses agree', async () => {
    const { api } = apiWith([{ id: 2, sha: HEAD, created_at: at(2) }], {
      2: [status('success', 3), status('success', 3)],
    })
    await expect(latestMarker(api)).resolves.toEqual({ sha: HEAD, state: 'success' })
  })

  it('calls ANY tie between records ambiguous, same SHA or not', async () => {
    // Same SHA matters as much as different: two records for one SHA, one
    // successful and one failed, would otherwise resolve by API return order.
    for (const shas of [
      [OLDER, HEAD],
      [HEAD, HEAD],
    ]) {
      const { api, asked } = apiWith(
        shas.map((sha, index) => ({ id: index + 1, sha, created_at: at(2) })),
        { 1: [status('success', 2)], 2: [status('failure', 2)] },
      )
      await expect(latestMarker(api)).resolves.toMatchObject({ state: 'ambiguous' })
      // A tie makes "which is newest" unanswerable whatever the statuses say,
      // so they are not even requested.
      expect(asked).toEqual([DEPLOYMENTS])
    }
  })

  it('returns null when there are no records', async () => {
    const { api, asked } = apiWith([], {})
    await expect(latestMarker(api)).resolves.toBeNull()
    expect(asked).toEqual([DEPLOYMENTS])
  })

  it('propagates an API failure rather than reporting a state it cannot support', async () => {
    const api = async (path: string): Promise<unknown> => {
      if (path === DEPLOYMENTS) return [{ id: 1, sha: HEAD, created_at: at(1) }]
      throw new Error('gh: HTTP 502')
    }
    await expect(latestMarker(api)).rejects.toThrow('gh: HTTP 502')
  })
})
