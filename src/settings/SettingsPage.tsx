import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Fingerprint, KeyRound, Scale, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { isPasskeySupported, passkeyErrorMessage } from '../lib/passkey'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  fetchLists,
  fetchAllUserListItems,
} from '../lib/queries'
import { gearItemsToCsv, listItemsToCsv } from '../lib/csv'
import TypedConfirmDialog from '../components/TypedConfirmDialog'
import UnitSegmentedControl from '../components/UnitSegmentedControl'
import FormLabel from '../components/FormLabel'
import PrimaryButton from '../components/PrimaryButton'
import { TABLE_RADIUS, TABLE_STRONG_DIVIDER, TABLE_SURFACE_BG } from '../components/flat-table-styles'
import { useDocumentTitle } from '../lib/use-document-title'

export default function SettingsPage() {
  useDocumentTitle('Settings')
  const { session } = useAuth()
  const email = session?.user.email ?? ''

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>

      <Section title="Account" subtitle={email} icon={<KeyRound size={16} />}>
        <ChangePasswordForm />
      </Section>

      <Section
        title="Passkeys"
        subtitle="Sign in with biometrics or a security key instead of a password"
        icon={<Fingerprint size={16} />}
      >
        <PasskeysSection />
      </Section>

      {/* Weight units — canonical control for the global display
          preference. Replaces the small g/oz toggle that used to live in
          the authed top bar; the public Share page has its own segmented
          control so viewers (who have no Settings access) can still
          change units. */}
      <Section title="Display" subtitle="How weights are shown across the app" icon={<Scale size={16} />}>
        <UnitSegmentedControl
          idPrefix="settings"
          label="Weight units"
          hint="Affects how gear, list, and pack weights are displayed everywhere."
        />
      </Section>

      <Section title="Download all data" subtitle="A zip with your gear inventory and one CSV per list" icon={<Download size={16} />}>
        <DownloadAllData />
      </Section>

      <Section title="Danger zone" subtitle="Permanently delete your account and all of your data" icon={<Trash2 size={16} className="text-red-500" />} danger>
        <DeleteAccount />
      </Section>
    </div>
  )
}

// ── Sections ───────────────────────────────────────────────────────────────────

function Section({
  title,
  subtitle,
  icon,
  danger,
  children,
}: {
  title: string
  subtitle?: string
  icon: React.ReactNode
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={`${TABLE_RADIUS} border ${TABLE_SURFACE_BG} p-5 ${
        danger ? 'border-red-200' : TABLE_STRONG_DIVIDER
      }`}
    >
      <div className="flex items-start gap-2 mb-4">
        <span className="mt-0.5 text-gray-500">{icon}</span>
        <div>
          <h2 className={`text-base font-semibold ${danger ? 'text-red-700' : 'text-gray-900'}`}>{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

// ── Change password ───────────────────────────────────────────────────────────

function ChangePasswordForm() {
  const { session } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!currentPassword) {
      setMsg({ kind: 'err', text: 'Enter your current password.' })
      return
    }
    if (password.length < 8) {
      setMsg({ kind: 'err', text: 'Password must be at least 8 characters.' })
      return
    }
    if (password !== confirm) {
      setMsg({ kind: 'err', text: 'Passwords do not match.' })
      return
    }
    if (password === currentPassword) {
      setMsg({ kind: 'err', text: 'Choose a password different from your current one.' })
      return
    }
    const email = session?.user.email
    if (!email) {
      setMsg({ kind: 'err', text: 'No active session. Please sign in again.' })
      return
    }
    setBusy(true)
    // Re-auth: verify the current password before allowing the change.
    // signInWithPassword's side effect is a fresh session token for the
    // same user — equivalent access, just refreshed. Surface a generic
    // "incorrect" message rather than Supabase's verbatim error so we
    // don't leak rate-limit details or account-state probing surface.
    const { error: verifyError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (verifyError) {
      setBusy(false)
      setMsg({ kind: 'err', text: 'Current password is incorrect.' })
      return
    }
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setMsg({ kind: 'err', text: error.message })
      return
    }
    setCurrentPassword('')
    setPassword('')
    setConfirm('')
    setMsg({ kind: 'ok', text: 'Password updated.' })
  }

  return (
    <form onSubmit={submit} className="space-y-3 max-w-md">
      <div>
        <FormLabel htmlFor="cp-current">Current password</FormLabel>
        <input
          id="cp-current"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <FormLabel htmlFor="cp-new">New password</FormLabel>
        <input
          id="cp-new"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <FormLabel htmlFor="cp-confirm">Confirm new password</FormLabel>
        <input
          id="cp-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
      )}
      <PrimaryButton
        type="submit"
        disabled={busy || !currentPassword || !password || !confirm}
      >
        {busy ? 'Updating…' : 'Change password'}
      </PrimaryButton>
    </form>
  )
}

// ── Passkeys ────────────────────────────────────────────────────────────────

// Element type of the passkey list, derived from the SDK return type so it
// can't drift from auth-js (avoids importing a possibly-unexported name).
type Passkey = NonNullable<
  Awaited<ReturnType<typeof supabase.auth.passkey.list>>['data']
>[number]

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function PasskeysSection() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user.id
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  // The list (a server call) works anywhere; only creating a passkey needs a
  // WebAuthn-capable browser, so we gate just the "Add" button on support.
  const canCreate = isPasskeySupported()

  const {
    data: passkeys,
    isPending,
    isError,
  } = useQuery({
    // Key by user id so a same-tab account switch can't show the previous
    // user's passkeys from cache under the global 30s staleTime.
    queryKey: queryKeys.passkeys(userId ?? ''),
    enabled: !!userId,
    queryFn: async (): Promise<Passkey[]> => {
      const { data, error } = await supabase.auth.passkey.list()
      if (error) throw error
      return data ?? []
    },
  })

  const reload = () => qc.invalidateQueries({ queryKey: queryKeys.passkeys(userId ?? '') })

  async function addPasskey() {
    setMsg(null)
    setAdding(true)
    try {
      // registerPasskey runs the full create() ceremony against the current
      // session; a cancelled prompt maps to null (shown as nothing).
      const { error } = await supabase.auth.registerPasskey()
      if (error) {
        const text = passkeyErrorMessage(error)
        if (text) setMsg({ kind: 'err', text })
        return
      }
      setMsg({ kind: 'ok', text: 'Passkey added.' })
      await reload()
    } catch (err) {
      const text = passkeyErrorMessage(err)
      if (text) setMsg({ kind: 'err', text })
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-4">
      {isPending ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-red-600">Could not load your passkeys.</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-gray-500">
          You don't have any passkeys yet. Add one to sign in without your password.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {passkeys.map((pk) => (
            <PasskeyRow key={pk.id} passkey={pk} onChanged={reload} onError={(text) => setMsg({ kind: 'err', text })} />
          ))}
        </ul>
      )}

      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-green-600' : 'text-red-600'}`}>{msg.text}</p>
      )}

      {canCreate ? (
        <PrimaryButton onClick={addPasskey} disabled={adding}>
          {adding ? 'Waiting for passkey…' : 'Add a passkey'}
        </PrimaryButton>
      ) : (
        <p className="text-xs text-gray-500">This browser can't create passkeys.</p>
      )}
    </div>
  )
}

function PasskeyRow({
  passkey,
  onChanged,
  onError,
}: {
  passkey: Passkey
  onChanged: () => void | Promise<void>
  onError: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(passkey.friendly_name ?? '')
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [busy, setBusy] = useState(false)

  async function saveName() {
    setBusy(true)
    const { error } = await supabase.auth.passkey.update({
      passkeyId: passkey.id,
      friendlyName: draft.trim() || 'Passkey',
    })
    setBusy(false)
    if (error) {
      onError('Could not rename passkey.')
      return
    }
    setEditing(false)
    await onChanged()
  }

  async function remove() {
    setBusy(true)
    const { error } = await supabase.auth.passkey.delete({ passkeyId: passkey.id })
    setBusy(false)
    if (error) {
      onError('Could not remove passkey.')
      return
    }
    await onChanged()
  }

  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={120}
            className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <p className="truncate text-sm font-medium text-gray-900">
            {passkey.friendly_name || 'Passkey'}
          </p>
        )}
        <p className="mt-0.5 text-xs text-gray-500">
          Added {formatDate(passkey.created_at)}
          {passkey.last_used_at ? ` · Last used ${formatDate(passkey.last_used_at)}` : ''}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {editing ? (
          <>
            <PrimaryButton size="sm" onClick={saveName} disabled={busy}>
              Save
            </PrimaryButton>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setDraft(passkey.friendly_name ?? '')
              }}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : confirmingRemove ? (
          <>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {busy ? 'Removing…' : 'Confirm remove'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                // Seed the draft from the current name each time, not the
                // initial mount value — otherwise a second rename reopens with
                // the pre-rename text after the list refetches.
                setDraft(passkey.friendly_name ?? '')
                setEditing(true)
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Remove
            </button>
          </>
        )}
      </div>
    </li>
  )
}

// ── Download all ──────────────────────────────────────────────────────────────

function exportTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    '-',
    pad(date.getMinutes()),
    '-',
    pad(date.getSeconds()),
  ].join('')
}

function DownloadAllData() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleDownload() {
    if (!session) return
    const userId = session.user.id
    setBusy(true)
    setMsg(null)
    try {
      // Dynamic import: fflate (~20 KB gzipped) is needed only for this
      // handler. Top-level static import would charge every authed user
      // for it on initial load even though most never click download.
      // Kick off the chunk fetch in parallel with the data fetches rather
      // than awaiting it serially — both are network-bound, no reason for
      // one to gate the other.
      const fflatePromise = import('fflate')
      const [fflate, categories, gearItems, lists, allItems] = await Promise.all([
        fflatePromise,
        qc.fetchQuery({ queryKey: queryKeys.categories(), queryFn: () => fetchCategories(userId) }),
        qc.fetchQuery({ queryKey: queryKeys.gearItems(), queryFn: () => fetchGearItems(userId) }),
        qc.fetchQuery({ queryKey: queryKeys.lists(), queryFn: () => fetchLists(userId) }),
        fetchAllUserListItems(userId),
      ])
      const { zipSync, strToU8 } = fflate

      const files: Record<string, Uint8Array> = {}
      files['gear-library.csv'] = strToU8(gearItemsToCsv(gearItems, categories))

      const itemsByListId = Map.groupBy(allItems, (item) => item.list_id)

      const seen = new Map<string, number>()
      for (const list of lists) {
        const items = itemsByListId.get(list.id) ?? []
        const base = list.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '') || 'list'
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const filename = count === 0 ? `${base}.csv` : `${base}-${count + 1}.csv`
        files[`lists/${filename}`] = strToU8(listItemsToCsv(items, categories))
      }

      const zipped = zipSync(files)
      const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `grampacker-export-${exportTimestamp()}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        onClick={handleDownload}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        <Download size={14} />
        {busy ? 'Building zip…' : 'Download .zip'}
      </button>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </div>
  )
}

// ── Delete account ────────────────────────────────────────────────────────────

function DeleteAccount() {
  const { session } = useAuth()
  const [confirming, setConfirming] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()

  function reset() {
    setVerifying(false)
    setCurrentPassword('')
    setErr(null)
  }

  // Reentrancy gate: `busy` (set true here, cleared only on error paths)
  // is the single source of truth that keeps double-submits from racing
  // each other to call `delete_account()`. The submit button is also
  // `disabled={busy}` below; do not remove that without replacing this
  // guard with an explicit idempotency check.
  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErr(null)
    const email = session?.user.email
    if (!email) {
      setBusy(false)
      setErr('No active session. Please sign in again.')
      return
    }
    // Re-auth the same way ChangePasswordForm does — verify the current
    // password before invoking the destructive RPC. Generic "incorrect"
    // copy mirrors the password-change flow so we don't leak rate-limit
    // detail or account-state probing surface.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (verifyError) {
      setBusy(false)
      setErr('Current password is incorrect.')
      return
    }
    const { error } = await supabase.rpc('delete_account')
    if (error) {
      setBusy(false)
      setErr(error.message)
      return
    }
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div>
      <p className="text-sm text-gray-600 mb-3">
        This permanently deletes your account, gear inventory, and all lists. This cannot be undone.
      </p>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Delete my account
      </button>
      {err && !verifying && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {confirming && (
        <TypedConfirmDialog
          title="Delete account"
          message="This will permanently delete your account and everything in it. There is no recovery."
          confirmPhrase="delete"
          confirmLabel="Continue"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            setVerifying(true)
          }}
        />
      )}
      {verifying && (
        <form
          onSubmit={handleDelete}
          className="mt-4 space-y-3 max-w-md rounded-lg border border-red-200 bg-red-50 p-4"
        >
          <div>
            <FormLabel htmlFor="da-current">
              Confirm with your current password
            </FormLabel>
            <input
              id="da-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !currentPassword}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete account'}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
