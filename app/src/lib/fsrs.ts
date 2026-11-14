import { createEmptyCard, fsrs, Rating, type Card, type Grade, type State } from 'ts-fsrs'
import type { CardRow } from '../db/schema'

const scheduler = fsrs()
export { Rating }
export type { Grade }

export function newCard(lemmaId: number, now = new Date()): CardRow {
  return toRow(lemmaId, createEmptyCard(now))
}

export function schedule(row: CardRow, rating: Grade, now = new Date()): CardRow {
  const { card } = scheduler.next(fromRow(row), now, rating)
  return toRow(row.lemmaId, card)
}

function toRow(lemmaId: number, c: Card): CardRow {
  return {
    id: lemmaId, lemmaId,
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
