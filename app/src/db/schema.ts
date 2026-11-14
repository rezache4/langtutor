import Dexie, { type Table } from 'dexie'

// ---- Dictionary data (from the bundle; read-only, never synced) ----
export interface Lemma { id: number; lemma: string; pos: string; glosses: string[]; freq?: number }
export interface Form { id?: number; form: string; lemmaId: number; tags: string }
export interface Example { id: number; lemmaId: number; form: string; it: string; en: string }

/**
 * Sync conventions for every USER-OWNED table (cards, reviewLog, settings, userEntries, userExamples,
 * userGlosses): a stable string primary key, `updatedAt` (ms epoch) stamped on every write, and soft
 * deletion (`deleted: 1`, never a real delete). Readers must ignore rows with `deleted`.
 * `entryPool` is a local cache derived from the bundle and is NOT user-owned (never synced).
 */
export interface Syncable { updatedAt: number; deleted?: 0 | 1 }

/** One example sentence as shown in review / on pages, whatever its origin. */
export interface Ex { id: number | string; form: string; it: string; en: string; user?: boolean }

export interface CardRow extends Syncable {
  id: string // 'l<lemmaId>' for dictionary lemmas, 'e<entryId>' for userEntries (see lib/cards.ts)
  lemmaId?: number
  entryId?: string
  due: number // epoch ms
  stability: number
  difficulty: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: number
  lastExampleId?: number | string // example shown on the last review
  seenExamples?: (number | string)[] // recent example ids, oldest first
  suspended?: 0 | 1 // 1 = marked as known, never scheduled until unsuspended
}
export interface ReviewLog extends Syncable {
  id: string
  cardId: string
  rating: number
  reviewedAt: number
  deviceId: string
  synced: 0 | 1
  due?: number // the card's new due (epoch ms) after this review
  state?: number // the card's state BEFORE this review (0 new, 1 learning, 2 review, 3 relearning)
}
export interface Setting extends Syncable { key: string; value: unknown }

/** A word or phrase of the user's own (e.g. imported from Reverso) that is not a dictionary lemma. */
export interface UserEntry extends Syncable {
  id: string // uuid
  text: string
  kind: 'word' | 'phrase'
  glosses: string[]
}
/** An example sentence the user brought along; attached to a lemma or to a userEntry (phraseId). */
export interface UserExample extends Syncable {
  id: string // uuid
  lemmaId: number | null
  phraseId: string | null
  form: string
  it: string
  en: string
  source: 'reverso'
  src?: string // normalised source text of the import row (idempotency key)
}
/** One user-supplied gloss of a dictionary lemma. */
export interface UserGloss extends Syncable {
  id: string // uuid
  lemmaId: number
  text: string
  source: 'reverso'
  src?: string
}
/** Local cache: Tatoeba sentences containing an entry's text (derived data, not synced). */
export interface EntryPool { entryId: string; examples: Ex[]; computedAt: number }

class LangTutorDB extends Dexie {
  lemmas!: Table<Lemma, number>
  formIndex!: Table<Form, number>
  examples!: Table<Example, number>
  cards!: Table<CardRow, string>
  reviewLog!: Table<ReviewLog, string>
  settings!: Table<Setting, string>
  userEntries!: Table<UserEntry, string>
  userExamples!: Table<UserExample, string>
  userGlosses!: Table<UserGloss, string>
  entryPool!: Table<EntryPool, string>
  constructor() {
    super('langtutor')
    this.version(1).stores({
      lemmas: 'id, lemma',
      forms: 'form, lemmaId',
      examples: 'id, lemmaId',
      cards: 'id, lemmaId, due',
      reviewLog: 'id, cardId, reviewedAt, synced',
      settings: 'key',
    })
    // v2: a form can belong to several lemmas, so forms need a surrogate key
    this.version(2).stores({ forms: null, formIndex: '++id, form, lemmaId' }).upgrade(tx => tx.table('settings').delete('bundleVersion'))
    // v3: sync-ready user tables. Cards get string ids ('l<lemmaId>') and updatedAt; review logs point at them.
    this.version(3).stores({
      cards: 'id, lemmaId, entryId, due, updatedAt',
      reviewLog: 'id, cardId, reviewedAt, synced, updatedAt',
      settings: 'key, updatedAt',
      userEntries: 'id, text, updatedAt',
      userExamples: 'id, lemmaId, phraseId, src, updatedAt',
      userGlosses: 'id, lemmaId, src, updatedAt',
      entryPool: 'entryId',
    }).upgrade(async tx => {
      const now = Date.now()
      const cards = await tx.table('cards').toArray()
      await tx.table('cards').clear() // primary keys change from number to string
      await tx.table('cards').bulkPut(cards.map(c => {
        const lemmaId = Number(c.lemmaId ?? c.id)
        return { ...c, id: `l${lemmaId}`, lemmaId, updatedAt: c.last_review ?? now }
      }))
      await tx.table('reviewLog').toCollection().modify(l => {
        if (typeof l.cardId === 'number') l.cardId = `l${l.cardId}`
        l.updatedAt = l.reviewedAt ?? now
      })
      await tx.table('settings').toCollection().modify(s => { s.updatedAt = now })
    })
  }
}
export const db = new LangTutorDB()

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db.settings.get(key)
  return r && !r.deleted ? (r.value as T) : fallback
}
export const setSetting = (key: string, value: unknown) => db.settings.put({ key, value, updatedAt: Date.now() })

export async function getDeviceId(): Promise<string> {
  let id = await getSetting<string | null>('deviceId', null)
  if (!id) { id = crypto.randomUUID(); await setSetting('deviceId', id) }
  return id
}
