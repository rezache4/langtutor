import { useState } from 'react'
import '../sync.css'
import { signInWithGoogle, signOut, useSession } from '../lib/auth'
import { syncEnabled } from '../lib/supabase'
import { syncNow, useSyncStatus } from '../lib/sync'

const ago = (t: number | null) => {
  if (!t) return 'never'
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(t).toLocaleString()
}

/** Optional account + sync controls. Everything works signed-out. */
export default function AccountCard() {
  const session = useSession()
  const st = useSyncStatus()
  const [err, setErr] = useState('')
  if (!syncEnabled) return (
    <div className="card account" data-testid="account">
      <h2>Account</h2>
      <p className="muted">Sync is not configured in this build. Everything stays on this device.</p>
    </div>
  )
  const label = st.state === 'syncing' ? 'Syncing…'
    : st.state === 'offline' ? 'Offline, will sync when back online'
    : st.state === 'error' ? `Sync failed: ${st.error}`
    : `Last sync: ${ago(st.lastSync)}`
  return (
    <div className="card account" data-testid="account">
      <h2>Account</h2>
      {session === undefined && <p className="muted">Checking…</p>}
      {session === null && <>
        <p className="muted">Optional. Sign in to back up your progress and sync it between devices.</p>
        <div className="row"><button onClick={async () => setErr((await signInWithGoogle()) ?? '')}>Sign in with Google</button></div>
        {err && <p className="acct-status err">{err}</p>}
      </>}
      {session && <>
        <p className="acct-email" data-testid="acct-email">{session.user.email}</p>
        <div className="row">
          <button onClick={() => void syncNow()} disabled={st.state === 'syncing'}>Sync now</button>
          <button onClick={() => void signOut()}>Sign out</button>
        </div>
        <p className={'acct-status ' + (st.state === 'error' ? 'err' : st.state === 'idle' ? 'ok' : '')} data-testid="sync-status">
          {label}{st.state === 'idle' && st.lastSync ? ` · ↓${st.pulled} ↑${st.pushed}` : ''}
        </p>
      </>}
    </div>
  )
}
