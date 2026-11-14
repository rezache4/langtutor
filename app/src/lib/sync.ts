import { useSyncExternalStore } from 'react'
import { db } from '../db/schema'
import { supabase } from './supabase'
import { getSession } from './auth'
import { syncOnce, SYNC_TABLES, type Cursor, type DocRow, type Meta, type Remote, type SyncTables } from './syncCore'

export type SyncState = 'off' | 'signedout' | 'idle' | 'syncing' | 'offline' | 'error'
export interface SyncStatus { state: SyncState; lastSync: number | null; error: string | null; pulled: number; pushed: number }

const LS = 'lt.sync.'
const ls = {
  get: (k: string) => { try { return localStorage.getItem(LS + k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(LS + k, v) } catch { /* private mode */ } },
}

let status: SyncStatus = { state: supabase ? 'signedout' : 'off', lastSync: Number(ls.get('lastSync')) || null, error: null, pulled: 0, pushed: 0 }
const listeners = new Set<() => void>()
const setStatus = (p: Partial<SyncStatus>) => { status = { ...status, ...p }; listeners.forEach(l => l()) }
export const useSyncStatus = (): SyncStatus =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => status)

function remoteFor(): Remote {
  const sb = supabase!
  return {
    async push(docs: DocRow[]) {
      const { error } = await sb.rpc('upsert_docs', { docs })
      if (error) throw new Error(error.message)
    },
    async pull(after: Cursor, limit: number) {
      const { data, error } = await sb.rpc('pull_docs', { p_at: after.at, p_tbl: after.tbl, p_id: after.id, p_limit: limit })
      if (error) throw new Error(error.message)
      return (data ?? []) as DocRow[]
    },
  }
}

const tables = Object.fromEntries(SYNC_TABLES.map(t => [t.name, (db as unknown as Record<string, unknown>)[t.name]])) as unknown as SyncTables
const metaFor = (uid: string): Meta => ({ get: k => ls.get(`${uid}.${k}`), set: (k, v) => ls.set(`${uid}.${k}`, v) })

let running: Promise<void> | null = null
let again = false

/** Run a sync now (no-op when signed out). Never throws; failures only update the status. */
export function syncNow(): Promise<void> {
  if (!supabase) return Promise.resolve()
  if (running) { again = true; return running }
  running = (async () => {
    try {
      const session = await getSession()
      if (!session) { setStatus({ state: 'signedout', error: null }); return }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) { setStatus({ state: 'offline' }); return }
      setStatus({ state: 'syncing', error: null })
      const r = await syncOnce(tables, remoteFor(), metaFor(session.user.id))
      const now = Date.now()
      ls.set('lastSync', String(now))
      setStatus({ state: 'idle', lastSync: now, error: null, pulled: r.pulled, pushed: r.pushed })
    } catch (e) {
      setStatus({ state: navigator.onLine === false ? 'offline' : 'error', error: (e as Error).message || 'Sync failed' })
    }
  })().finally(() => {
    running = null
    if (again) { again = false; void syncNow() }
  })
  return running
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Debounced sync (default 30 s after the last call). */
export function syncSoon(ms = 30_000) {
  if (!supabase) return
  clearTimeout(timer)
  timer = setTimeout(() => { void syncNow() }, ms)
}

let started = false
/** Wire up all triggers once: app start, sign-in, visibility, online, debounced after local writes. */
export function startSync() {
  if (started || !supabase) return
  started = true
  supabase.auth.onAuthStateChange((event, session) => {
    if (!session) { if (event === 'SIGNED_OUT') setStatus({ state: 'signedout', error: null }); return }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') setTimeout(() => { void syncNow() }, 0) // not inside the auth callback (deadlock-prone)
  })
  let lastVisible = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastVisible < 15_000) return
    lastVisible = Date.now()
    void syncNow()
  })
  window.addEventListener('online', () => { void syncNow() })
  for (const t of SYNC_TABLES) {
    const tbl = (db as unknown as Record<string, { hook: (ev: string, fn: () => void) => void }>)[t.name]
    for (const ev of ['creating', 'updating', 'deleting']) tbl.hook(ev, () => { syncSoon() })
  }
}
