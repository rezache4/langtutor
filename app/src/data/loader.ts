import { db, getSetting, setSetting, type Example, type Form, type Lemma } from '../db/schema'

export interface Bundle { version: string | number; lemmas: Lemma[]; forms: Form[]; examples: Example[] }
export interface Progress { phase: 'download' | 'import'; pct: number }

const CHUNK = 5000
const BASE = import.meta.env.BASE_URL

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

async function parse(url: string, onProgress: (p: Progress) => void) {
  const r = await fetchBytes(url, onProgress)
  if (!r) return null
  try {
    const b = JSON.parse(new TextDecoder().decode(r.buf)) as Bundle
    if (!Array.isArray(b.lemmas)) return null
    return { b, sig: r.sig }
  } catch { return null } // e.g. SPA fallback html
}

async function putChunks<T>(table: { bulkPut(r: T[]): Promise<unknown> }, rows: T[], done: { n: number }, total: number, cb: (p: Progress) => void) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.transaction('rw', table as never, async () => { await table.bulkPut(rows.slice(i, i + CHUNK)) })
    done.n += Math.min(CHUNK, rows.length - i)
    cb({ phase: 'import', pct: Math.round((done.n / total) * 100) })
  }
}

/** Download + import bundle if changed. Returns true if data was (re)loaded. */
export async function loadBundle(onProgress: (p: Progress) => void = () => {}): Promise<boolean> {
  const url = `${BASE}data/bundle.json`
  const hasData = (await db.lemmas.count()) > 0
  const curVer = await getSetting<string | number | null>('bundleVersion', null)
  const curSig = await getSetting<string | null>('bundleSig', null)

  // Cheap change check so we don't re-download ~47MB each launch.
  if (hasData && curVer !== null) {
    try {
      const h = await fetch(url, { method: 'HEAD' })
      if (!h.ok || curSig === null || sigOf(h) === curSig) return false
    } catch { return false } // offline
  }

  let parsed = await parse(url, onProgress).catch(() => null)
  if (!parsed) parsed = await parse(`${BASE}data/sample.json`, onProgress).catch(() => null)
  if (!parsed) return false
  const { b, sig } = parsed
  if (hasData && curVer === b.version) { await setSetting('bundleSig', sig); return false }

  const total = b.lemmas.length + b.forms.length + b.examples.length
  const done = { n: 0 }
  onProgress({ phase: 'import', pct: 0 })
  await db.formIndex.clear() // surrogate keys: avoid duplicates on re-import
  await putChunks(db.lemmas, b.lemmas, done, total, onProgress)
  await putChunks(db.formIndex, b.forms, done, total, onProgress)
  await putChunks(db.examples, b.examples, done, total, onProgress)
  await setSetting('bundleSig', sig)
  await setSetting('bundleVersion', b.version)
  return true
}
