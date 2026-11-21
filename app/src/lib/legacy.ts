import { lemmaCardId } from '../db/schema'

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
