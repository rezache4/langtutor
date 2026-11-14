import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import type { AudioMode } from './tts'

export type FrontMode = 'sentence' | 'lemma'
export interface AppSettings {
  newPerDay: number
  sessionSize: number
  frontMode: FrontMode
  audioMode: AudioMode
  desiredRetention: number
}
export const DEFAULTS: AppSettings = { newPerDay: 15, sessionSize: 20, frontMode: 'sentence', audioMode: 'tap', desiredRetention: 0.9 }

export async function loadSettings(): Promise<AppSettings> {
  const rows = (await db.settings.toArray()).filter(r => !r.deleted)
  const m = new Map(rows.map(r => [r.key, r.value]))
  const out = { ...DEFAULTS } as Record<string, unknown>
  for (const k of Object.keys(DEFAULTS)) if (m.has(k) && m.get(k) != null) out[k] = m.get(k)
  return out as unknown as AppSettings
}

/** Live settings (undefined while loading). */
export const useSettings = () => useLiveQuery(loadSettings, [])
export const useAudioMode = (): AudioMode =>
  useLiveQuery(async () => ((await db.settings.get('audioMode'))?.value as AudioMode) ?? DEFAULTS.audioMode, []) ?? DEFAULTS.audioMode
