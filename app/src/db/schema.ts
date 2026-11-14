import Dexie, { type Table } from 'dexie'

export interface Lemma { id: number; lemma: string; pos: string; glosses: string[] }
export interface Form { id?: number; form: string; lemmaId: number; tags: string }
export interface Example { id: number; lemmaId: number; form: string; it: string; en: string }
export interface CardRow {
  id: number // = lemmaId
  lemmaId: number
  due: number // epoch ms
  stability: number
  difficulty: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: number
  lastExampleId?: number // example shown on the last review
  seenExamples?: number[] // recent example ids, oldest first
}
export interface ReviewLog {
  id: string
  cardId: number
  rating: number
  reviewedAt: number
  deviceId: string
  synced: 0 | 1
  due?: number // the card's new due (epoch ms) after this review
  state?: number // the card's state BEFORE this review (0 new, 1 learning, 2 review, 3 relearning)
}
export interface Setting { key: string; value: unknown }

class LangTutorDB extends Dexie {
  lemmas!: Table<Lemma, number>
  formIndex!: Table<Form, number>
  examples!: Table<Example, number>
  cards!: Table<CardRow, number>
  reviewLog!: Table<ReviewLog, string>
  settings!: Table<Setting, string>
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
  }
}
export const db = new LangTutorDB()

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const r = await db.settings.get(key)
  return r ? (r.value as T) : fallback
}
export const setSetting = (key: string, value: unknown) => db.settings.put({ key, value })

export async function getDeviceId(): Promise<string> {
  let id = await getSetting<string | null>('deviceId', null)
  if (!id) { id = crypto.randomUUID(); await setSetting('deviceId', id) }
  return id
}
