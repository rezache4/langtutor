import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Example, type Lemma } from '../db/schema'
import { newCard } from '../lib/fsrs'
import { Highlighted, Speak } from '../lib/ui'
import { nextReviewText } from '../lib/time'
import { GROUPS, codesOf, groupOf, labelsOf, type TagGroup } from '../lib/tags'

function shuffle<T>(a: T[]): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] }
  return r
}

export default function Word() {
  const { lemma = '' } = useParams()
  const [sp] = useSearchParams()
  const id = Number(sp.get('id')) || 0
  const nav = useNavigate()
  const locState = useLocation().state as { form?: string; fromReview?: boolean } | null
  const stateForm = locState?.form
  const alsoIds = (sp.get('also') ?? '').split(',').map(Number).filter(Boolean)
  const alsoKey = alsoIds.join(',')
  const hl = (sp.get('form') ?? stateForm ?? '').toLowerCase()
  const [chip, setChip] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [moreGl, setMoreGl] = useState(false)
  const data = useLiveQuery(async () => {
    let l = id ? await db.lemmas.get(id) : undefined
    if (!l || l.lemma !== lemma) l = await db.lemmas.where('lemma').equals(lemma).first()
    if (!l) return null
    const examples = await db.examples.where('lemmaId').equals(l.id).toArray()
    const forms = await db.formIndex.where('lemmaId').equals(l.id).toArray()
    const card = (await db.cards.get(l.id)) ?? null
    const also = (await db.lemmas.bulkGet(alsoKey ? alsoKey.split(',').map(Number) : [])).filter((x): x is Lemma => !!x && x.id !== l.id)
    return { l, examples, forms, card, also }
  }, [lemma, id, alsoKey])

  const lemmaId = data?.l.id
  const nEx = data?.examples.length
  const shuffled = useMemo<Example[]>(() => {
    const s = shuffle(data?.examples ?? [])
    if (!hl) return s
    return [...s.filter(e => e.form === hl), ...s.filter(e => e.form !== hl)] // searched form first
  }, [lemmaId, nEx, hl]) // eslint-disable-line react-hooks/exhaustive-deps
  const tagsOf = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const f of data?.forms ?? []) m.set(f.form, [...(m.get(f.form) ?? []), ...codesOf(f.tags)])
    return m
  }, [data?.forms])
  const grouped = useMemo(() => {
    const c = new Map<string, number>()
    for (const e of data?.examples ?? []) c.set(e.form, (c.get(e.form) ?? 0) + 1)
    const g = new Map<TagGroup, [string, number][]>()
    for (const [f, n] of [...c.entries()].sort((a, b) => b[1] - a[1])) {
      const code = (tagsOf.get(f) ?? []).find(x => labelsOf(x).length)
      const grp = code ? groupOf(code) : 'Other'
      g.set(grp, [...(g.get(grp) ?? []), [f, n]])
    }
    return GROUPS.filter(x => g.has(x)).map(x => [x, g.get(x)!] as const)
  }, [data?.examples, tagsOf])

  if (data === undefined) return null
  if (data === null) return <><h1>{lemma}</h1><p className="muted">Not found.</p></>
  const { l, card, also } = data
  const active = chip && data.examples.some(e => e.form === chip) ? chip : null
  const shown = active ? shuffled.filter(e => e.form === active) : shuffled
  const gl = moreGl ? l.glosses : l.glosses.slice(0, 3)
  return (
    <>
      {locState?.fromReview && <button className="link" onClick={() => nav(-1)}>← Back to review</button>}
      <h1>{l.lemma} <Speak text={l.lemma} /></h1>
      <p className="muted"><span className="tag">{l.pos}</span> {gl.join('; ')}
        {l.glosses.length > 3 && <> <button className="link" onClick={() => setMoreGl(!moreGl)}>{moreGl ? 'less' : `more (${l.glosses.length - 3})`}</button></>}
      </p>
      {also.length > 0 && (
        <p className="muted also">Also: {also.map((x, i) => (
          <span key={x.id}>{i > 0 && ', '}<Link to={`/word/${encodeURIComponent(x.lemma)}?id=${x.id}&form=${encodeURIComponent(hl)}`}>{x.lemma}</Link></span>
        ))}</p>
      )}
      {card ? (
        <div className="card inreview">
          <div><strong>In review</strong> · {card.state === 0 ? 'new card' : `next: ${nextReviewText(card).replace('Next review: ', '')}`}</div>
          <button className="link" onClick={() => db.cards.delete(l.id)}>Remove</button>
        </div>
      ) : (
        <button className="primary big" onClick={() => db.cards.put(newCard(l.id))}>Add to review</button>
      )}
      <h2>Examples ({shown.length})</h2>
      {grouped.length > 0 && (
        <div className="filter">
          <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            Filter by form{active ? `: ${active}` : ''} {open ? '▴' : '▾'}
          </button>
          {active && <button className="link" onClick={() => setChip(null)}>clear</button>}
          {open && grouped.map(([g, items]) => (
            <div key={g} className="group">
              <small className="muted">{g}</small>
              <div className="row chips">
                {items.map(([f, n]) => (
                  <button key={f} className={'chip' + (active === f ? ' on' : '')}
                    onClick={() => { setChip(active === f ? null : f); setOpen(false) }}>{f} <small>{n}</small></button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {shown.length === 0 && <p className="muted">No examples.</p>}
      {shown.map(e => {
        const labels = [...new Set(labelsOf((tagsOf.get(e.form) ?? []).join(' | ')))].slice(0, 2)
        return (
          <div key={e.id} className="card">
            <div><Highlighted text={e.it} form={e.form} /> <Speak text={e.it} /></div>
            <div className="muted">{e.en}</div>
            {labels.length > 0 && <small className="subtle">{e.form}: {labels.join(' / ')}</small>}
          </div>
        )
      })}
    </>
  )
}
