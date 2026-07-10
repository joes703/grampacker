import { useRef, useState } from 'react'
import { MIN_PASSWORD_LENGTH } from '../../shared/auth'
import { authClient } from '../lib/auth-client'
import { authErrorMessage } from '../auth/auth-errors'
import FormLabel from '../components/FormLabel'
import PrimaryButton from '../components/PrimaryButton'

// Change-password form for the settings Account section. better-auth's
// changePassword verifies currentPassword AND sets the new one in a single
// call (no separate re-auth step the old Supabase app needed), and
// revokeOtherSessions signs out every OTHER device while keeping this one
// (the endpoint mints a fresh session for the caller). Client-side checks
// mirror the old app; the server is the real gate (min length, current-
// password verification).
export default function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  // Synchronous in-flight guard: the button is disabled while busy, but a
  // form is still submittable via Enter/programmatic submit, and busy is
  // render-derived (lags a synchronous double-submit). This ref blocks the
  // second submit in the same tick so changePassword can't fire twice.
  const submitting = useRef(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting.current) return
    setMsg(null)
    if (!currentPassword) {
      setMsg({ kind: 'err', text: 'Enter your current password.' })
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setMsg({
        kind: 'err',
        text: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      })
      return
    }
    if (password !== confirm) {
      setMsg({ kind: 'err', text: 'New passwords do not match.' })
      return
    }
    if (password === currentPassword) {
      setMsg({ kind: 'err', text: 'Choose a password different from your current one.' })
      return
    }

    submitting.current = true
    setBusy(true)
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword: password,
        // Signs out every OTHER session; this one is refreshed and kept.
        revokeOtherSessions: true,
      })
      if (error) {
        // A wrong current password comes back as INVALID_PASSWORD; name it
        // precisely. Everything else defers to the shared mapper (429 copy
        // + server message fallback).
        setMsg({
          kind: 'err',
          text:
            error.code === 'INVALID_PASSWORD'
              ? 'Current password is incorrect.'
              : authErrorMessage(error, "Couldn't change your password. Please try again."),
        })
        return
      }
      setCurrentPassword('')
      setPassword('')
      setConfirm('')
      setMsg({ kind: 'ok', text: 'Password updated.' })
    } catch {
      // better-auth normally returns { error } rather than rejecting, but a
      // thrown client/network failure must not strand the form in
      // "Updating..." - surface a generic message and reset below.
      setMsg({ kind: 'err', text: "Couldn't change your password. Please try again." })
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3">
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
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-green-700' : 'text-rose-700'}`}>
          {msg.text}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy || !currentPassword || !password || !confirm}>
        {busy ? 'Updating...' : 'Change password'}
      </PrimaryButton>
    </form>
  )
}
