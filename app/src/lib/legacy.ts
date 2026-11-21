import { db, lemmaCardId } from '../db/schema'

type Row = Record<string, unknown>
export interface UpgradedExport { cards: Row[]; reviewLog: Row[]; userExamples: Row[]; userGlosses: Row[]; dropped: number }

const LEGACY_ID = /^l(\d+)$/
const legacyLemmaId = (x: unknown): number | undefined =>
  typeof x === 'number' ? x : typeof x === 'string' && LEGACY_ID.test(x) ? Number(LEGACY_ID.exec(x)![1]) : undefined

/**
 * Exports made before stable lemma keys refer to lemmas by build-local numeric id. Resolve them through the lemmas of the
 * CURRENT bundle (best effort: right when the export came from the same build) and drop what cannot be resolved.
 */
export async function upgradeExport(
  d: { cards: Row[]; reviewLog: Row[]; userExamples?: Row[]; userGlosses?: Row[] },
  keyOfId: (id: number) => Promise<string | undefined>,
  now = Date.now(),
): Promise<UpgradedExport> {
  let dropped = 0
  const idMap = new Map<unknown, string>() // old card id -> new card id
  const cards: Row[] = []
  for (const c of d.cards) {
    if (c.lemmaKey != null || c.entryId != null) { cards.push({ ...c, updatedAt: c.updatedAt ?? now }); continue }
    const lid = legacyLemmaId(c.lemmaId) ?? legacyLemmaId(c.id)
    const key = lid != null ? await keyOfId(lid) : undefined
    if (!key) { dropped++; continue }
    const { lemmaId: _drop, ...rest } = c
    void _drop
    idMap.set(c.id, lemmaCardId(key))
    cards.push({ ...rest, id: lemmaCardId(key), lemmaKey: key, updatedAt: c.updatedAt ?? now })
  }

  const reviewLog: Row[] = []
  for (const l of d.reviewLog) {
    const mapped = idMap.get(l.cardId)
    if (mapped) reviewLog.push({ ...l, cardId: mapped, updatedAt: l.updatedAt ?? l.reviewedAt ?? now })
    else if (legacyLemmaId(l.cardId) != null) dropped++ // its card could not be resolved
    else reviewLog.push({ ...l, updatedAt: l.updatedAt ?? l.reviewedAt ?? now })
  }

  const fix = async (rows: Row[] = []) => {
    const out: Row[] = []
    for (const r of rows) {
      if (r.lemmaKey !== undefined || r.lemmaId === undefined) { out.push(r); continue }
      const { lemmaId, ...rest } = r
      if (lemmaId == null) { out.push({ ...rest, lemmaKey: null }); continue }
      const key = typeof lemmaId === 'number' ? await keyOfId(lemmaId) : undefined
      if (key) out.push({ ...rest, lemmaKey: key }); else dropped++
    }
    return out
  }
  return { cards, reviewLog, userExamples: await fix(d.userExamples), userGlosses: await fix(d.userGlosses), dropped }
}

/**
 * Rows in the pre-v4 shape (numeric lemma id) can still arrive from the server, pushed by a device that had not been
 * upgraded yet. Convert them to stable keys through the lemmas of the local bundle (right while it is the same build
 * they were made with) and tombstone the old rows so the deletion syncs. Idempotent; does nothing until the dictionary is loaded.
 */
export async function repairLegacyRows(): Promise<number> {
  if (!(await db.lemmas.count())) return 0
  const now = Date.now()
  const keyOf = async (id: unknown) => (typeof id === 'number' ? (await db.lemmas.get(id))?.key : undefined)
  let fixed = 0
  await db.transaction('rw', [db.lemmas, db.cards, db.reviewLog, db.userExamples, db.userGlosses], async () => {
    for (const c of await db.cards.filter(x => !x.deleted && x.lemmaKey == null && x.entryId == null).toArray()) {
      const key = await keyOf((c as unknown as { lemmaId?: number }).lemmaId ?? legacyLemmaId(c.id))
      if (!key) continue
      const { lemmaId: _drop, ...rest } = c as unknown as Row
      void _drop
      const id = lemmaCardId(key)
      const cur = await db.cards.get(id)
      if (!cur || cur.deleted || Number(cur.updatedAt) < Number(c.updatedAt)) await db.cards.put({ ...rest, id, lemmaKey: key, updatedAt: now } as never)
      await db.cards.put({ ...c, deleted: 1, updatedAt: now })
      fixed++
    }
    for (const l of await db.reviewLog.filter(x => !x.deleted && typeof x.cardId === 'string' && LEGACY_ID.test(x.cardId)).toArray()) {
      const key = await keyOf(legacyLemmaId(l.cardId))
      if (key) { await db.reviewLog.put({ ...l, cardId: lemmaCardId(key), updatedAt: now }); fixed++ }
    }
    for (const t of [db.userExamples, db.userGlosses] as unknown as { filter(f: (r: Row) => boolean): { toArray(): Promise<Row[]> }; put(r: Row): Promise<unknown> }[]) {
      for (const r of await t.filter(x => !x.deleted && x.lemmaKey === undefined && x.lemmaId != null).toArray()) {
        const key = await keyOf(r.lemmaId)
        if (!key) continue
        const { lemmaId: _d, ...rest } = r
        void _d
        await t.put({ ...rest, lemmaKey: key, updatedAt: now })
        fixed++
      }
    }
  })
  return fixed
}
