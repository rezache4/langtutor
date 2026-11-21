import { db, entryCardId, lemmaCardId, type CardRow, type UserEntry } from '../db/schema'
import { newCard } from './fsrs'

export { entryCardId, lemmaCardId }
export type CardRef = { lemmaKey: string } | { entryId: string }
export const cardIdOf = (r: CardRef) => ('lemmaKey' in r ? lemmaCardId(r.lemmaKey) : entryCardId(r.entryId))

/** A card that exists (not soft-deleted). */
export const isLive = (c: CardRow | undefined | null): c is CardRow => !!c && !c.deleted
/** A card that can be scheduled: live and not marked as known. */
export const isActive = (c: CardRow | undefined | null): c is CardRow => isLive(c) && !c.suspended

/** Single write path for cards: always stamps updatedAt. */
export async function putCard(row: CardRow): Promise<CardRow> {
  const r = { ...row, updatedAt: Date.now() }
  await db.cards.put(r)
  return r
}

/** Create the card if there is no live one; returns the card either way. */
export async function addCard(ref: CardRef, opts: { suspended?: boolean } = {}): Promise<CardRow> {
  const cur = await db.cards.get(cardIdOf(ref))
  if (isLive(cur)) return cur
  return putCard({ ...newCard(ref), suspended: opts.suspended ? 1 : 0 })
}

/** Soft delete: the row stays (deleted: 1) so the deletion can sync. */
export async function removeCard(id: string) {
  const c = await db.cards.get(id)
  if (c) await putCard({ ...c, deleted: 1 })
}

/** Mark as known (suspend) / unsuspend. Creates a suspended card if the word has none yet. */
export async function setSuspended(ref: CardRef, on: boolean) {
  const c = await db.cards.get(cardIdOf(ref))
  if (!isLive(c)) { if (on) await addCard(ref, { suspended: true }); return }
  await putCard({ ...c, suspended: on ? 1 : 0 })
}

export async function softDeleteEntry(id: string) {
  const e = await db.userEntries.get(id)
  if (e) await db.userEntries.put({ ...e, deleted: 1, updatedAt: Date.now() } satisfies UserEntry)
  await removeCard(entryCardId(id))
}
