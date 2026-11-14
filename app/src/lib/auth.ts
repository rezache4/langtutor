import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Optional Google sign-in. The app works fully signed-out; signing in only turns sync on. */
export async function signInWithGoogle(): Promise<string | null> {
  if (!supabase) return 'Sync is not configured'
  const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
  return error?.message ?? null
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut() // local data stays on the device
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null
  try { return (await supabase.auth.getSession()).data.session } catch { return null }
}

/** Current session (null = signed out, undefined = still loading). */
export function useSession(): Session | null | undefined {
  const [s, setS] = useState<Session | null | undefined>(supabase ? undefined : null)
  useEffect(() => {
    if (!supabase) return
    let on = true
    void getSession().then(x => { if (on) setS(x) })
    const { data } = supabase.auth.onAuthStateChange((_e, sess) => { if (on) setS(sess) })
    return () => { on = false; data.subscription.unsubscribe() }
  }, [])
  return s
}
