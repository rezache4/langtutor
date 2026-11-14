import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { syncOnce, SYNC_TABLES, type Cursor, type DocRow, type Meta, type Remote, type SyncTables } from '../src/lib/syncCore'

/** In-memory remote with the same semantics as supabase/migrations/0001_init.sql. */
class FakeRemote implements Remote {
  rows = new Map<string, DocRow>()
  clock = Date.parse('2026-01-01T00:00:00Z')
  pushes = 0
  pulls = 0
  async push(docs: DocRow[]) {
    this.pushes++
    for (const d of docs) {
      const k = `${d.tbl}\0${d.id}`
      const cur = this.rows.get(k)
      if (cur && !(d.updated_at > cur.updated_at)) continue // LWW: strictly newer only
      this.rows.set(k, { ...d, synced_at: new Date(this.clock++).toISOString() }) // server-assigned cursor
    }
  }
  async pull(after: Cursor, limit: number) {
    this.pulls++
    const gt = (r: DocRow) => (r.synced_at! !== after.at ? r.synced_at! > after.at : (r.tbl !== after.tbl ? r.tbl > after.tbl : r.id > after.id))
    return [...this.rows.values()].filter(gt)
      .sort((a, b) => a.synced_at!.localeCompare(b.synced_at!) || a.tbl.localeCompare(b.tbl) || a.id.localeCompare(b.id)).slice(0, limit)
  }
}

let n = 0
function device() {
  const db = new Dexie('dev' + n++)
  db.version(1).stores({
    cards: 'id, updatedAt', reviewLog: 'id, updatedAt', settings: 'key, updatedAt',
    userEntries: 'id, updatedAt', userExamples: 'id, updatedAt', userGlosses: 'id, updatedAt',
  })
  const store = new Map<string, string>()
  const meta: Meta = { get: k => store.get(k) ?? null, set: (k, v) => { store.set(k, v) } }
  const tables = Object.fromEntries(SYNC_TABLES.map(t => [t.name, db.table(t.name)])) as unknown as SyncTables
  return { db, tables, meta, sync: (r: Remote, o = {}) => syncOnce(tables, r, meta, { rewindMs: 0, ...o }) }
}
const card = (id: string, updatedAt: number, extra = {}) => ({ id, due: 0, reps: 1, updatedAt, ...extra })

describe('sync', () => {
  it('merges two devices both ways, first sign-in with existing local data', async () => {
    const r = new FakeRemote(), a = device(), b = device()
    await a.tables.cards.bulkPut([card('l1', 100), card('l2', 100)])
    await b.tables.cards.bulkPut([card('l2', 200, { reps: 9 }), card('l3', 100)]) // b is newer on l2
    await a.tables.reviewLog.put({ id: 'r1', cardId: 'l1', updatedAt: 150 })
    await a.sync(r); await b.sync(r); await a.sync(r)
    for (const d of [a, b]) {
      expect((await d.tables.cards.toArray()).map(c => c.id).sort()).toEqual(['l1', 'l2', 'l3'])
      expect((await d.tables.cards.get('l2')).reps).toBe(9)
      expect(await d.tables.reviewLog.count()).toBe(1)
    }
  })

  it('last write wins, older remote never overwrites newer local', async () => {
    const r = new FakeRemote(), a = device(), b = device()
    await a.tables.cards.put(card('l1', 100, { reps: 1 }))
    await a.sync(r); await b.sync(r)
    await a.tables.cards.put(card('l1', 300, { reps: 3 }))
    await b.tables.cards.put(card('l1', 200, { reps: 2 }))
    await a.sync(r); await b.sync(r); await a.sync(r)
    expect((await a.tables.cards.get('l1')).reps).toBe(3)
    expect((await b.tables.cards.get('l1')).reps).toBe(3)
    expect(r.rows.get('cards\0l1')!.updated_at).toBe(300)
  })

  it('propagates soft deletes and resurrection', async () => {
    const r = new FakeRemote(), a = device(), b = device()
    await a.tables.cards.put(card('l1', 100)); await a.sync(r); await b.sync(r)
    await b.tables.cards.put(card('l1', 200, { deleted: 1 })); await b.sync(r); await a.sync(r)
    expect((await a.tables.cards.get('l1')).deleted).toBe(1)
    expect(r.rows.get('cards\0l1')!.deleted).toBe(true)
    await a.tables.cards.put(card('l1', 300, { deleted: 0 })); await a.sync(r); await b.sync(r)
    expect((await b.tables.cards.get('l1')).deleted).toBe(0)
  })

  it('never syncs device-local settings but syncs the others', async () => {
    const r = new FakeRemote(), a = device(), b = device()
    await a.tables.settings.bulkPut([
      { key: 'deviceId', value: 'A', updatedAt: 5 }, { key: 'bundleVersion', value: 'v', updatedAt: 5 },
      { key: 'bundleSig', value: 's', updatedAt: 5 }, { key: 'newPerDay', value: 30, updatedAt: 5 },
    ])
    await b.tables.settings.put({ key: 'deviceId', value: 'B', updatedAt: 9 })
    await a.sync(r); await b.sync(r); await a.sync(r)
    expect([...r.rows.keys()]).toEqual(['settings\0newPerDay'])
    expect((await b.tables.settings.get('deviceId')).value).toBe('B')
    expect((await b.tables.settings.get('newPerDay')).value).toBe(30)
    expect(await b.tables.settings.get('bundleVersion')).toBeUndefined()
  })

  it('pages the pull cursor and the push batches', async () => {
    const r = new FakeRemote(), a = device(), b = device()
    await a.tables.reviewLog.bulkPut(Array.from({ length: 25 }, (_, i) => ({ id: 'r' + String(i).padStart(2, '0'), cardId: 'l1', updatedAt: 1000 + (i % 3) })))
    await a.sync(r, { batchSize: 10 })
    expect(r.pushes).toBe(3) // 25 rows in batches of 10
    expect(r.rows.size).toBe(25)
    const res = await b.sync(r, { pageSize: 4 })
    expect(res.pulled).toBe(25)
    expect(await b.tables.reviewLog.count()).toBe(25)
    expect(res.pushed).toBe(0) // pulled rows are not echoed back
    const before = r.pushes
    const again = await b.sync(r, { pageSize: 4 })
    expect(again).toEqual({ pulled: 0, pushed: 0 })
    expect(r.pushes).toBe(before)
  })

  it('incremental: only changes after the cursor move, and a failed push is retried', async () => {
    const r = new FakeRemote(), a = device(), b = device()
    await a.tables.cards.put(card('l1', 100)); await a.sync(r); await b.sync(r)
    await a.tables.cards.put(card('l2', 200))
    const real = r.push.bind(r)
    r.push = async () => { throw new Error('network') }
    await expect(a.sync(r)).rejects.toThrow('network')
    r.push = real
    await a.sync(r)
    expect((await b.sync(r)).pulled).toBe(1)
    expect(await b.tables.cards.get('l2')).toBeTruthy()
  })
})
