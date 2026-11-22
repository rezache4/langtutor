import type { Table } from 'dexie'

/**
 * Sync engine core: pure with respect to the network and the database (both injected), so it can be
 * tested against fake-indexeddb and an in-memory remote. See lib/sync.ts for the Supabase wiring.
 *
 * Model: every user-owned row has a stable key, `updatedAt` (client ms epoch) and soft deletion.
 * Conflicts are last-write-wins on `updatedAt`. Pull uses a server-side cursor (synced_at), push uses a
 * per-table local cursor over `updatedAt`.
 */

export const SYNC_TABLES = [
  { name: 'cards', pk: 'id' },
  { name: 'reviewLog', pk: 'id' },
  { name: 'settings', pk: 'key' },
  { name: 'userEntries', pk: 'id' },
  { name: 'userExamples', pk: 'id' },
  { name: 'userGlosses', pk: 'id' },
] as const
export type TblName = (typeof SYNC_TABLES)[number]['name']

/** Settings that describe this device / its local data bundle and must never leave it. */
export const LOCAL_ONLY_SETTINGS: ReadonlySet<string> = new Set(['bundleVersion', 'bundleSig', 'coreSig', 'examplesVersion', 'deviceId'])

export interface DocRow {
  tbl: string
  id: string
  data: Record<string, unknown>
  updated_at: number
  deleted: boolean
  synced_at?: string
}
export interface Cursor { at: string; tbl: string; id: string }
export interface Remote {
  /** Last-write-wins upsert (remote ignores rows that are not newer than what it has). */
  push(docs: DocRow[]): Promise<void>
  /** Rows after the cursor, ordered by (synced_at, tbl, id), at most `limit`. */
  pull(after: Cursor, limit: number): Promise<DocRow[]>
}
export interface Meta { get(key: string): string | null; set(key: string, value: string): void }
export type SyncTables = Record<TblName, Table<any, any>>

export interface SyncResult { pulled: number; pushed: number }
export interface SyncOptions {
  pageSize?: number; batchSize?: number; rewindMs?: number
  /** Runs after the pull and before the push, so rows it rewrites are pushed in the same cycle. */
  afterPull?: () => Promise<void>
}

const EPOCH: Cursor = { at: '1970-01-01T00:00:00.000Z', tbl: '', id: '' }
const pkOf = (t: (typeof SYNC_TABLES)[number], row: Record<string, unknown>) => String(row[t.pk])
const skip = (tbl: string, id: string) => tbl === 'settings' && LOCAL_ONLY_SETTINGS.has(id)

export function toDoc(tbl: TblName, id: string, row: Record<string, unknown>): DocRow {
  return { tbl, id, data: row, updated_at: Number(row.updatedAt) || 0, deleted: !!row.deleted }
}

/** Row to store locally for a remote doc. */
export function fromDoc(d: DocRow): Record<string, unknown> {
  const row: Record<string, unknown> = { ...d.data, updatedAt: d.updated_at }
  if (d.deleted) row.deleted = 1
  return row
}

function readCursor(meta: Meta, k: string): Cursor {
  try { const c = JSON.parse(meta.get(k) ?? 'null'); if (c && typeof c.at === 'string') return c } catch { /* ignore */ }
  return EPOCH
}

export async function syncOnce(tables: SyncTables, remote: Remote, meta: Meta, opts: SyncOptions = {}): Promise<SyncResult> {
  const pageSize = opts.pageSize ?? 1000
  const batchSize = opts.batchSize ?? 500
  const rewindMs = opts.rewindMs ?? 10_000
  const result: SyncResult = { pulled: 0, pushed: 0 }
  const fromRemote = new Map<string, number>() // 'tbl|id' -> updated_at we just stored locally

  // ---- Pull. Rewind the cursor a little: transactions can commit out of synced_at order. Re-fetched
  // rows are harmless (a row is only applied when strictly newer than the local one).
  let cur = readCursor(meta, 'pullCursor')
  if (cur !== EPOCH) cur = { at: new Date(Date.parse(cur.at) - rewindMs).toISOString(), tbl: '', id: '' }
  for (;;) {
    const page = await remote.pull(cur, pageSize)
    const byTbl = new Map<TblName, DocRow[]>()
    for (const d of page) {
      if (skip(d.tbl, d.id)) continue
      const t = SYNC_TABLES.find(x => x.name === d.tbl)
      if (!t) continue // unknown table from a newer app version
      byTbl.set(t.name, [...(byTbl.get(t.name) ?? []), d])
    }
    for (const [name, docs] of byTbl) {
      const table = tables[name]
      const t = SYNC_TABLES.find(x => x.name === name)!
      await table.db.transaction('rw', table, async () => {
        const local = await table.bulkGet(docs.map(d => d.id))
        const apply: Record<string, unknown>[] = []
        docs.forEach((d, i) => {
          const l = local[i] as Record<string, unknown> | undefined
          if (l && Number(l.updatedAt) >= d.updated_at) return
          const row = fromDoc(d)
          row[t.pk] = d.id
          apply.push(row)
          fromRemote.set(`${name}|${d.id}`, d.updated_at)
        })
        if (apply.length) await table.bulkPut(apply)
        result.pulled += apply.length
      })
    }
    if (page.length) {
      const last = page[page.length - 1]
      cur = { at: last.synced_at!, tbl: last.tbl, id: last.id }
      meta.set('pullCursor', JSON.stringify(cur))
    }
    if (page.length < pageSize) break
  }

  await opts.afterPull?.()

  // ---- Push. Local cursor per table over updatedAt, inclusive, plus the ids already known to the remote
  // at exactly the cursor's millisecond (so same-ms writes are neither missed nor re-sent).
  for (const t of SYNC_TABLES) {
    const key = `pushed.${t.name}`
    const since = Number(meta.get(key) ?? 0)
    let atSince: string[] = []
    try { atSince = JSON.parse(meta.get(key + '.ids') ?? '[]') } catch { /* ignore */ }
    const known = new Set(atSince)
    const rows = (await tables[t.name].where('updatedAt').aboveOrEqual(since).toArray()) as Record<string, unknown>[]
    let max = since
    for (const r of rows) { const u = Number(r.updatedAt) || 0; if (u > max) max = u }
    const docs: DocRow[] = []
    const atMax: string[] = max === since ? [...known] : []
    for (const r of rows) {
      const id = pkOf(t, r)
      const u = Number(r.updatedAt) || 0
      if (u === max && !atMax.includes(id)) atMax.push(id)
      if (u === since && known.has(id)) continue
      if (skip(t.name, id)) continue
      if (fromRemote.get(`${t.name}|${id}`) === u) continue // just pulled, remote already has it
      docs.push(toDoc(t.name, id, r))
    }
    for (let i = 0; i < docs.length; i += batchSize) {
      await remote.push(docs.slice(i, i + batchSize))
      result.pushed += Math.min(batchSize, docs.length - i)
    }
    meta.set(key, String(max))
    meta.set(key + '.ids', JSON.stringify(atMax))
  }
  return result
}
