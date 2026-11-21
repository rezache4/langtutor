import { db, type CardRow, type EntryPool, type UserEntry, type UserExample, type UserGloss } from '../db/schema'
import { isLive, lemmaCardId } from './cards'
import { newCard } from './fsrs'
import { rankForm } from './lookup'
import { loadCorpus, norm, searchCorpus, type Corpus } from './userdata'

/** Minimal RFC 4180 CSV parser (quoted fields, "" escapes, newlines inside quotes, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(x => x !== '')) rows.push(row) }
  return rows
}

export interface ImportSummary {
  rows: number
  linked: number // single words mapped to a dictionary lemma
  words: number // single words not in the dictionary -> own entries
  phrases: number // multi-word phrases -> own entries
  skipped: number // already imported, repeated in the file, or empty
  newCards: number
}

const WORD = /^\p{L}+$/u
const clean = (s: string | undefined) => (s ?? '').replace(/<\/?[a-z][^>]*>/gi, '').replace(/\s+/g, ' ').trim()

/**
 * Import a Reverso "Favorites" CSV. Idempotent: rows whose source text was already imported are skipped.
 * Single words go to the most frequent matching lemma (example + glosses attached, card created if
 * missing); everything else becomes a userEntry with its own card and a Tatoeba example pool.
 */
export async function importReverso(text: string, progress: (done: number, total: number) => void = () => {}): Promise<ImportSummary> {
  const table = parseCsv(text)
  const head = (table[0] ?? []).map(h => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name)
  const iSrc = col('source')
  if (iSrc < 0) throw new Error('Not a Reverso favorites CSV (no "source" column)')
  const [iTgt, iEx, iExEn, iCom] = ['target', 'source example', 'target example', 'comment'].map(col)
  const data = table.slice(1)
  const sum: ImportSummary = { rows: data.length, linked: 0, words: 0, phrases: 0, skipped: 0, newCards: 0 }

  // What is already there (deleted rows included: a deleted import is not resurrected).
  const done = new Set<string>()
  for (const e of await db.userEntries.toArray()) done.add(norm(e.text))
  for (const g of await db.userGlosses.toArray()) if (g.src) done.add(g.src)
  for (const x of await db.userExamples.toArray()) if (x.src) done.add(x.src)

  const now = Date.now()
  const entries: UserEntry[] = [], examples: UserExample[] = [], glosses: UserGloss[] = [], cards: CardRow[] = [], pools: EntryPool[] = []
  const lemmaCards = new Map<string, boolean>() // lemma key -> a live card exists (or is being created)
  let corpus: Corpus | undefined

  for (let n = 0; n < data.length; n++) {
    if (n % 25 === 0) { progress(n, data.length); await new Promise(r => setTimeout(r)) }
    const r = data[n]
    const source = clean(r[iSrc])
    const key = norm(source)
    const target = clean(iTgt >= 0 ? r[iTgt] : '')
    const itEx = clean(iEx >= 0 ? r[iEx] : '')
    const enEx = clean(iExEn >= 0 ? r[iExEn] : '')
    const gl: string[] = []
    for (const g of [target, ...clean(iCom >= 0 ? r[iCom] : '').split(',')]) {
      const t = g.trim()
      if (t && !gl.some(x => norm(x) === norm(t))) gl.push(t)
    }
    if (!key || (!gl.length && !itEx) || done.has(key)) { sum.skipped++; continue }
    done.add(key)

    const ranked = WORD.test(source) ? await rankForm(key) : []
    if (ranked.length) {
      const lemmaKey = ranked[0].l.key
      for (const text of gl) glosses.push({ id: crypto.randomUUID(), lemmaKey, text, source: 'reverso', src: key, updatedAt: now })
      if (itEx) examples.push({ id: crypto.randomUUID(), lemmaKey, phraseId: null, form: key, it: itEx, en: enEx, source: 'reverso', src: key, updatedAt: now })
      if (!lemmaCards.has(lemmaKey)) lemmaCards.set(lemmaKey, isLive(await db.cards.get(lemmaCardId(lemmaKey))))
      if (!lemmaCards.get(lemmaKey)) { cards.push(newCard({ lemmaKey })); lemmaCards.set(lemmaKey, true); sum.newCards++ }
      sum.linked++
    } else {
      const entry: UserEntry = { id: crypto.randomUUID(), text: source, kind: WORD.test(source) ? 'word' : 'phrase', glosses: gl, updatedAt: now }
      entries.push(entry)
      if (itEx) examples.push({ id: crypto.randomUUID(), lemmaKey: null, phraseId: entry.id, form: source, it: itEx, en: enEx, source: 'reverso', src: key, updatedAt: now })
      cards.push(newCard({ entryId: entry.id }))
      corpus ??= await loadCorpus()
      pools.push({ entryId: entry.id, examples: searchCorpus(corpus, source), computedAt: now })
      sum.newCards++
      if (entry.kind === 'word') sum.words++; else sum.phrases++
    }
  }
  progress(data.length, data.length)

  await db.transaction('rw', [db.userEntries, db.userExamples, db.userGlosses, db.cards, db.entryPool], async () => {
    await db.userEntries.bulkPut(entries)
    await db.userExamples.bulkPut(examples)
    await db.userGlosses.bulkPut(glosses)
    await db.cards.bulkPut(cards.map(c => ({ ...c, updatedAt: now })))
    await db.entryPool.bulkPut(pools)
  })
  return sum
}
