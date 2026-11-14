import { useMemo, useState } from 'react'
import { useLocation, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Example } from '../db/schema'
import { newCard } from '../lib/fsrs'
import { speak } from '../lib/tts'

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function Highlighted({ text, form }: { text: string; form: string }) {
  if (!form) return <>{text}</>
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${esc(form)})(?![\\p{L}\\p{N}])`, 'iu')
  const m = re.exec(text)
  if (!m) return <>{text}</>
  return <>{text.slice(0, m.index)}<mark>{m[1]}</mark>{text.slice(m.index + m[1].length)}</>
}

function shuffle<T>(a: T[]): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] }
  return r
}

export default function Word() {
  const { lemma = '' } = useParams()
  const [sp] = useSearchParams()
  const id = Number(sp.get('id')) || 0
  const hl = (useLocation().state as { form?: string } | null)?.form
  const [chip, setChip] = useState<string | null>(hl ?? null)
  const data = useLiveQuery(async () => {
    let l = id ? await db.lemmas.get(id) : undefined
    if (!l || l.lemma !== lemma) l = await db.lemmas.where('lemma').equals(lemma).first()
    if (!l) return null
    const examples = await db.examples.where('lemmaId').equals(l.id).toArray()
    const forms = await db.formIndex.where('lemmaId').equals(l.id).toArray()
    const card = (await db.cards.get(l.id)) ?? null
    return { l, examples, forms, card }
  }, [lemma, id])

  const lemmaId = data?.l.id
  const nEx = data?.examples.length
  const shuffled = useMemo<Example[]>(() => shuffle(data?.examples ?? []), [lemmaId, nEx]) // eslint-disable-line react-hooks/exhaustive-deps
  const tagsOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of data?.forms ?? []) {
      const t = Array.isArray(f.tags) ? (f.tags as string[]).join(' ') : f.tags
      const prev = m.get(f.form)
      m.set(f.form, prev && t ? `${prev} / ${t}` : prev ?? t)
    }
    return m
  }, [data?.forms])
  const chips = useMemo(() => {
    const c = new Map<string, number>()
    for (const e of data?.examples ?? []) c.set(e.form, (c.get(e.form) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [data?.examples])

  if (data === undefined) return null
  if (data === null) return <><h1>{lemma}</h1><p className="muted">Not found.</p></>
  const { l, card } = data
  const active = chip && chips.some(([f]) => f === chip) ? chip : null // searched form may have no examples
  const shown = active ? shuffled.filter(e => e.form === active) : shuffled
  return (
    <>
      <h1>{l.lemma} <button onClick={() => speak(l.lemma)} aria-label="Play">Play</button></h1>
      <p className="muted"><span className="tag">{l.pos}</span> {l.glosses.join('; ')}</p>
      <button className="primary" disabled={!!card} onClick={() => db.cards.put(newCard(l.id))}>
        {card ? 'In review deck' : 'Add to review'}
      </button>
      <h2>Examples ({shown.length})</h2>
      {chips.length > 0 && (
        <div className="row chips">
          <button className={'chip' + (active === null ? ' on' : '')} onClick={() => setChip(null)}>all</button>
          {chips.map(([f, n]) => (
            <button key={f} className={'chip' + (active === f ? ' on' : '')}
              onClick={() => setChip(active === f ? null : f)}>{f} <small>{n}</small></button>
          ))}
        </div>
      )}
      {shown.length === 0 && <p className="muted">No examples.</p>}
      {shown.map(e => (
        <div key={e.id} className="card">
          <div><Highlighted text={e.it} form={e.form} /> <button onClick={() => speak(e.it)} aria-label="Play">Play</button></div>
          <div className="muted">{e.en}</div>
          {tagsOf.get(e.form) && <small className="subtle">{e.form}: {tagsOf.get(e.form)}</small>}
        </div>
      ))}
    </>
  )
}
