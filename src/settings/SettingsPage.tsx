import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { zipSync, strToU8 } from 'fflate'
import { Download, KeyRound, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import {
  queryKeys,
  fetchCategories,
  fetchGearItems,
  fetchLists,
  fetchAllUserListItems,
} from '../lib/queries'
import type { ListItemWithGear } from '../lib/types'
import { gearItemsToCsv, listItemsToCsv } from '../lib/csv'
import TypedConfirmDialog from '../components/TypedConfirmDialog'
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

      <Section title="Download all data" subtitle="A zip with your gear library and one CSV per list" icon={<Download size={16} />}>
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
      className={`rounded-xl border bg-white p-5 ${
        danger ? 'border-red-200' : 'border-gray-200'
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
        <label htmlFor="cp-current" className="block text-sm font-medium text-gray-700 mb-1">Current password</label>
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
        <label htmlFor="cp-new" className="block text-sm font-medium text-gray-700 mb-1">New password</label>
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
        <label htmlFor="cp-confirm" className="block text-sm font-medium text-gray-700 mb-1">Confirm new password</label>
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
      <button
        type="submit"
        disabled={busy || !currentPassword || !password || !confirm}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Updating…' : 'Change password'}
      </button>
    </form>
  )
}

// ── Download all ──────────────────────────────────────────────────────────────

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
      const [categories, gearItems, lists, allItems] = await Promise.all([
        qc.fetchQuery({ queryKey: queryKeys.categories(), queryFn: fetchCategories }),
        qc.fetchQuery({ queryKey: queryKeys.gearItems(), queryFn: fetchGearItems }),
        qc.fetchQuery({ queryKey: queryKeys.lists(), queryFn: fetchLists }),
        fetchAllUserListItems(userId),
      ])

      const files: Record<string, Uint8Array> = {}
      files['gear-library.csv'] = strToU8(gearItemsToCsv(gearItems, categories))

      const itemsByListId = new Map<string, ListItemWithGear[]>()
      for (const item of allItems) {
        const arr = itemsByListId.get(item.list_id) ?? []
        arr.push(item)
        itemsByListId.set(item.list_id, arr)
      }

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
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `grampacker-${date}.zip`
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
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleDelete() {
    setBusy(true)
    setErr(null)
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
        This permanently deletes your account, gear library, and all lists. This cannot be undone.
      </p>
      <button
        onClick={() => setConfirming(true)}
        disabled={busy}
        className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        Delete my account
      </button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {confirming && (
        <TypedConfirmDialog
          title="Delete account"
          message="This will permanently delete your account and everything in it. There is no recovery."
          confirmPhrase="delete"
          confirmLabel={busy ? 'Deleting…' : 'Delete account'}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            handleDelete()
          }}
        />
      )}
    </div>
  )
}
