import {
  targetDefaultsResponseSchema,
  type SaveTargetDefaultsRequest,
  type TargetDefault,
} from '../../../shared/food-plans'
import { apiFetch } from '../api'

// Account-level default daily targets (slice 7). Copied by value into each
// NEW plan server-side at create; nothing else derives from them, so the
// save invalidates only its own key.
export type { TargetDefault }

export async function fetchTargetDefaults(): Promise<TargetDefault[]> {
  const res = await apiFetch('/target-defaults', targetDefaultsResponseSchema)
  return res.defaults
}

// FULL replace: the body is the complete default set (off = row omitted).
// Returns the fresh set the server now holds.
export async function saveTargetDefaults(
  body: SaveTargetDefaultsRequest,
): Promise<TargetDefault[]> {
  const res = await apiFetch('/target-defaults', targetDefaultsResponseSchema, {
    method: 'PUT',
    body,
  })
  return res.defaults
}
