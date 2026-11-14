import { db } from '../db/schema'
import type { AppSettings } from './settings'
import { startOfDay } from './time'
import { isActive } from './cards'

/** New cards already introduced (first-ever review) since local midnight. */
async function newToday(): Promise<number> {
  const logs = await db.reviewLog.where('reviewedAt').aboveOrEqual(startOfDay()).filter(l => l.state === 0 && !l.deleted).toArray()
  return new Set(logs.map(l => l.cardId)).size
}

export async function availableQueue(s: AppSettings, now = Date.now()) {
  const due = (await db.cards.where('due').belowOrEqual(now).filter(c => isActive(c) && c.state !== 0).sortBy('due')).map(c => c.id)
  const left = Math.max(0, s.newPerDay - (await newToday()))
  const fresh = (await db.cards.filter(c => isActive(c) && c.state === 0).sortBy('due')).map(c => c.id).slice(0, left)
  return { due, fresh }
}

/** Session queue: due cards first, then new ones, capped at the session size. */
export async function buildQueue(s: AppSettings): Promise<string[]> {
  const { due, fresh } = await availableQueue(s)
  return [...due, ...fresh].slice(0, Math.max(1, s.sessionSize))
}

export async function availableCount(s: AppSettings): Promise<number> {
  const { due, fresh } = await availableQueue(s)
  return due.length + fresh.length
}
