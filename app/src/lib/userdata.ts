import { db, type Ex, type Example, type UserEntry, type UserGloss } from '../db/schema'
import { esc } from './ui'

export const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()

/** Dictionary glosses plus the user's own, the latter deduped against the former. */
export function mergeGlosses(dict: string[], user: string[]): { dict: string[]; user: string[] } {
  const seen = new Set(dict.map(norm))
  const u: string[] = []
  for (const g of user) { const k = norm(g); if (k && !seen.has(k)) { seen.add(k); u.push(g) } }
  return { dict, user: u }
}

export async function userGlossTexts(lemmaId: number): Promise<string[]> {
  const rows = await db.userGlosses.where('lemmaId').equals(lemmaId).filter((g: UserGloss) => !g.deleted).toArray()
  return rows.map(r => r.text)
}

/** Tatoeba examples of a lemma plus the user's own for it. */
export async function lemmaExamples(lemmaId: number): Promise<Ex[]> {
  const [tat, mine] = await Promise.all([
    db.examples.where('lemmaId').equals(lemmaId).toArray(),
    db.userExamples.where('lemmaId').equals(lemmaId).filter(e => !e.deleted).toArray(),
  ])
  return [...mine.map(e => ({ id: e.id, form: e.form, it: e.it, en: e.en, user: true })), ...tat]
}

/** Case-insensitive, word-bounded matcher for a word or phrase (apostrophe variants and spacing tolerated). */
export function phraseRegex(text: string): RegExp {
  const body = esc(norm(text)).replace(/ /g, '\s+')
  return new RegExp(`(?<![\p{L}\p{N}])${body}(?![\p{L}\p{N}])`, 'iu')
}

export interface Corpus { rows: Example[]; lower: string[] }
export async function loadCorpus(): Promise<Corpus> {
  const rows = await db.examples.toArray()
  return { rows, lower: rows.map(r => norm(r.it)) }
}

/** Up to `limit` Tatoeba sentences containing the text (shortest first). */
export function searchCorpus(c: Corpus, text: string, limit = 25): Ex[] {
  const needle = norm(text)
  const re = phraseRegex(text)
  const hits: { i: number; m: string }[] = []
  for (let i = 0; i < c.lower.length; i++) {
    if (!c.lower[i].includes(needle.split(' ')[0])) continue
    const m = re.exec(c.lower[i])
    if (m) hits.push({ i, m: m[0] })
  }
  hits.sort((a, b) => c.rows[a.i].it.length - c.rows[b.i].it.length || c.rows[a.i].id - c.rows[b.i].id)
  return hits.slice(0, limit).map(({ i }) => ({ id: c.rows[i].id, form: text, it: c.rows[i].it, en: c.rows[i].en }))
}

/** Cached Tatoeba pool of an entry (computed on first use, in-browser). */
export async function entryPool(entry: UserEntry, corpus?: Corpus): Promise<Ex[]> {
  const hit = await db.entryPool.get(entry.id)
  if (hit) return hit.examples
  const examples = searchCorpus(corpus ?? await loadCorpus(), entry.text)
  await db.entryPool.put({ entryId: entry.id, examples, computedAt: Date.now() })
  return examples
}

/** The user's example(s) for an entry first, then the cached Tatoeba pool. */
export async function entryExamples(entry: UserEntry): Promise<Ex[]> {
  const mine = await db.userExamples.where('phraseId').equals(entry.id).filter(e => !e.deleted).toArray()
  return [...mine.map(e => ({ id: e.id, form: e.form, it: e.it, en: e.en, user: true })), ...await entryPool(entry)]
}
