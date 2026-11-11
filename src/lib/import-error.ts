import { ApiError } from './api'
import { ImportCapError } from './csv/import-plan'

// What to say when a CSV import fails. Only two failures prove nothing was
// imported, and their messages say what to fix: a cap check before the request,
// and a refusal from the server. After anything else the import may have gone
// through (a server failure, a dropped connection, a success response that
// arrived broken), and retrying could create a duplicate, so the user is told to
// check first (docs/client.md "Failures the user can see").
export function importErrorMessage(err: unknown, checkPlace: 'lists' | 'inventory'): string {
  if (err instanceof ImportCapError) return err.message
  if (err instanceof ApiError && err.status < 500) return err.message
  return `Couldn't confirm the import. Check your ${checkPlace} before trying again.`
}
