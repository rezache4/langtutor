import { createEmptyCard, fsrs, Rating, type Card, type Grade, type State } from 'ts-fsrs'
import type { CardRow } from '../db/schema'

export { Rating }
export type { Grade }
export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

const cache = new Map<number, ReturnType<typeof fsrs>>()
function scheduler(retention: number) {
  let s = cache.get(retention)
  if (!s) { s = fsrs({ request_retention: retention }); cache.set(retention, s) }
  return s
}

export function newCard(ref: { lemmaId: number } | { entryId: string }, now = new Date()): CardRow {
  const base = 'lemmaId' in ref ? { id: `l${ref.lemmaId}`, lemmaId: ref.lemmaId } : { id: `e${ref.entryId}`, entryId: ref.entryId }
  return toRow({ ...base, updatedAt: now.getTime() }, createEmptyCard(now))
}

/** Outcome of each of the four ratings, computed once so the preview shown equals what gets stored. */
export function preview(row: CardRow, now = new Date(), retention = 0.9): Record<Grade, CardRow> {
  const rec = scheduler(retention).repeat(fromRow(row), now)
  const out = {} as Record<Grade, CardRow>
  for (const g of GRADES) out[g] = { ...toRow(row, rec[g].card), lastExampleId: row.lastExampleId, seenExamples: row.seenExamples }
  return out
}

export function schedule(row: CardRow, rating: Grade, now = new Date(), retention = 0.9): CardRow {
  return preview(row, now, retention)[rating]
}

/** Identity (id, lemmaId/entryId, suspended...) comes from `base`; scheduling fields from the ts-fsrs card. */
function toRow(base: Pick<CardRow, 'id' | 'lemmaId' | 'entryId' | 'updatedAt' | 'suspended'>, c: Card): CardRow {
  return {
    id: base.id, lemmaId: base.lemmaId, entryId: base.entryId, updatedAt: base.updatedAt, suspended: base.suspended,
    due: c.due.getTime(),
    stability: c.stability, difficulty: c.difficulty,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses,
    state: c.state, last_review: c.last_review?.getTime(),
  }
}
function fromRow(r: CardRow): Card {
  return {
    due: new Date(r.due), stability: r.stability, difficulty: r.difficulty,
    scheduled_days: r.scheduled_days,
    learning_steps: r.learning_steps, reps: r.reps, lapses: r.lapses,
    state: r.state as State,
    last_review: r.last_review ? new Date(r.last_review) : undefined,
  }
}
