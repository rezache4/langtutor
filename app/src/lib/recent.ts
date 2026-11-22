import { db, getSetting, setSetting, type Lemma, type UserEntry } from '../db/schema'

/** Recently opened words (by stable lemma key) and own entries ('entry:<id>'), newest first. A synced setting. */
const KEY = 'recentWords'
const MAX = 12
const entryRef = (id: string) => `entry:${id}`

async function push(ref: string) {
  const cur = await getSetting<string[]>(KEY, [])
  if (cur[0] === ref) return
  await setSetting(KEY, [ref, ...cur.filter(x => x !== ref)].slice(0, MAX))
}
export const addRecentLemma = (l: Pick<Lemma, 'key'>) => push(l.key)
export const addRecentEntry = (id: string) => push(entryRef(id))
export const clearRecent = () => setSetting(KEY, [])

export type Recent = { kind: 'lemma'; l: Lemma } | { kind: 'entry'; entry: UserEntry }
/** Resolves the stored references against the current data; ones that no longer exist are skipped. */
export async function recentItems(): Promise<Recent[]> {
  const out: Recent[] = []
  for (const ref of await getSetting<string[]>(KEY, [])) {
    if (ref.startsWith('entry:')) {
      const entry = await db.userEntries.get(ref.slice(6))
      if (entry && !entry.deleted) out.push({ kind: 'entry', entry })
    } else {
      const l = await db.lemmas.where('key').equals(ref).first()
      if (l) out.push({ kind: 'lemma', l })
    }
  }
  return out
}
