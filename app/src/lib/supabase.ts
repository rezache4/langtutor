import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const syncEnabled = Boolean(url && key)
// PKCE: the OAuth redirect comes back as ?code=... (works with BrowserRouter, no #fragment tokens).
export const supabase: SupabaseClient | null = syncEnabled
  ? createClient(url!, key!, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null
