import { useSyncExternalStore } from 'react'
import { db, getSetting, setSetting, lemmaKeyOf, type Example, type Form, type Lemma } from '../db/schema'

/**
 * The dictionary ships as two files with the same `version`:
 *  - core.json (lemmas + forms, ~15 MB): enough to search and look words up; the app opens as soon as it is imported;
 *  - examples.json (sentences, ~19 MB): fetched in the background afterwards (see loadExamples / useExamplesStatus).
 * Lemma and example ids are build-local, so when the core changes the examples are cleared and reloaded.
 */
export interface Core { version: string | number; lemmas: Omit<Lemma, 'key'>[]; forms: Form[]; examples?: Example[] }
export interface ExampleFile { version: string | number; examples: Example[] }
export interface Progress { phase: 'download' | 'import'; pct: number }

const CHUNK = 5000
const BASE = import.meta.env.BASE_URL

// ---- status of the background example download, for the UI ----
export interface ExamplesStatus { state: 'idle' | 'loading' | 'ready' | 'error'; pct: number }
let exStatus: ExamplesStatus = { state: 'idle', pct: 0 }
const listeners = new Set<() => void>()
const setEx = (s: ExamplesStatus) => { exStatus = s; listeners.forEach(l => l()) }
export const useExamplesStatus = (): ExamplesStatus =>
  useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => exStatus)

async function fetchBytes(url: string, onProgress: (p: Progress) => void): Promise<{ buf: Uint8Array; sig: string } | null> {
  const res = await fetch(url)
  if (!res.ok || !res.body) return null
  const sig = sigOf(res)
  const total = Number(res.headers.get('Content-Length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); got += value.length
    onProgress({ phase: 'download', pct: total ? Math.min(99, Math.round((got / total) * 100)) : 0 })
  }
  const buf = new Uint8Array(got)
  let o = 0
  for (const p of parts) { buf.set(p, o); o += p.length }
  onProgress({ phase: 'download', pct: 100 })
  return { buf, sig }
}

const sigOf = (r: Response) =>
  [r.headers.get('ETag'), r.headers.get('Content-Length'), r.headers.get('Last-Modified')].join('|')

async function parse<T>(url: string, onProgress: (p: Progress) => void, valid: (x: T) => boolean) {
  const r = await fetchBytes(url, onProgress)
  if (!r) return null
  try {
    const b = JSON.parse(new TextDecoder().decode(r.buf)) as T
    return valid(b) ? { b, sig: r.sig } : null
  } catch { return null } // e.g. SPA fallback html
}

/** Insert rows into a table that was just cleared (add is cheaper than put: no existence check). */
async function addChunks<T>(table: { bulkAdd(r: T[]): Promise<unknown> }, rows: T[], done: { n: number }, total: number, cb: (p: Progress) => void) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.transaction('rw', table as never, async () => { await table.bulkAdd(rows.slice(i, i + CHUNK)) })
    done.n += Math.min(CHUNK, rows.length - i)
    cb({ phase: 'import', pct: Math.round((done.n / total) * 100) })
  }
}

/** Core dictionary: download + import if changed. Resolves when words can be looked up; examples continue in the background. */
export async function loadBundle(onProgress: (p: Progress) => void = () => {}): Promise<boolean> {
  const url = `${BASE}data/core.json`
  const hasData = (await db.lemmas.count()) > 0
  const curVer = await getSetting<string | number | null>('bundleVersion', null)
  const curSig = await getSetting<string | null>('coreSig', null)

  // Cheap change check so we don't re-download ~15MB each launch.
  if (hasData && curVer !== null && curSig !== null) {
    try {
      const h = await fetch(url, { method: 'HEAD' })
      if (!h.ok || sigOf(h) === curSig) { void loadExamples(); return false }
    } catch { void loadExamples(); return false } // offline
  }

  let parsed = await parse<Core>(url, onProgress, b => Array.isArray(b.lemmas) && Array.isArray(b.forms)).catch(() => null)
  if (!parsed) parsed = await parse<Core>(`${BASE}data/sample.json`, onProgress, b => Array.isArray(b.lemmas) && Array.isArray(b.forms)).catch(() => null)
  if (!parsed) { void loadExamples(); return false }
  const { b, sig } = parsed
  if (hasData && curVer === b.version) { await setSetting('coreSig', sig); void loadExamples(); return false }

  const total = b.lemmas.length + b.forms.length
  const done = { n: 0 }
  onProgress({ phase: 'import', pct: 0 })
  // Dictionary tables are replaced wholesale (ids change between builds); user tables are untouched.
  await db.formIndex.clear()
  await db.lemmas.clear()
  await db.examples.clear()
  await setSetting('examplesVersion', null)
  await addChunks(db.lemmas, b.lemmas.map(l => ({ ...l, key: lemmaKeyOf(l.lemma, l.pos) })), done, total, onProgress)
  await addChunks(db.formIndex, b.forms, done, total, onProgress)
  if (b.examples) await db.examples.bulkAdd(b.examples) // the tiny all-in-one sample file
  await setSetting('coreSig', sig)
  await setSetting('bundleVersion', b.version)
  await setSetting('examplesVersion', b.examples ? b.version : null)
  void loadExamples()
  return true
}

let examplesRun: Promise<void> | null = null
/** Download + import the example sentences matching the stored core (no-op when already there). Never throws; see useExamplesStatus. */
export function loadExamples(): Promise<void> {
  return (examplesRun ??= runExamples().catch(() => setEx({ state: 'error', pct: 0 })).finally(() => { examplesRun = null }))
}

async function runExamples(): Promise<void> {
  const ver = await getSetting<string | number | null>('bundleVersion', null)
  if (ver === null) return
  const have = await getSetting<string | number | null>('examplesVersion', null)
  // Installs from before the split imported the examples together with the core: adopt them instead of downloading again.
  const legacy = have === null && (await getSetting<string | null>('bundleSig', null)) !== null && (await db.examples.count()) > 0
  if (have === ver || legacy) {
    if (legacy) await setSetting('examplesVersion', ver)
    setEx({ state: 'ready', pct: 100 })
    return
  }
  setEx({ state: 'loading', pct: 0 })
  const progress = (p: Progress) => setEx({ state: 'loading', pct: Math.round(p.phase === 'download' ? p.pct * 0.5 : 50 + p.pct * 0.5) })
  const r = await parse<ExampleFile>(`${BASE}data/examples.json`, progress, b => Array.isArray(b.examples))
  if (!r || r.b.version !== ver) { setEx({ state: 'error', pct: 0 }); return } // missing, or not the build the core came from
  await db.examples.clear()
  await addChunks(db.examples, r.b.examples, { n: 0 }, r.b.examples.length, progress)
  await setSetting('examplesVersion', ver)
  setEx({ state: 'ready', pct: 100 })
}
