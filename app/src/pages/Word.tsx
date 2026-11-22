import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useLocation, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Ex } from '../db/schema'
import { ExLine, Speak } from '../lib/ui'
import { isLive, lemmaCardId } from '../lib/cards'
import { CardControls } from '../lib/CardControls'
import { ConjugationTable } from '../lib/ConjugationTable'
import { addRecentLemma } from '../lib/recent'
import { formLabel, rankForm, wordUrl } from '../lib/lookup'
import { lemmaExamples, mergeGlosses, userGlossTexts } from '../lib/userdata'
import { GROUPS, codesOf, groupOf, labelTag, posLabel, type TagGroup } from '../lib/tags'

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
  const hl = (sp.get('form') ?? stateForm ?? '').toLowerCase()
  const [chip, setChip] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [moreGl, setMoreGl] = useState(false)
  const data = useLiveQuery(async () => {
    let l = id ? await db.lemmas.get(id) : undefined
    if (!l || l.lemma !== lemma) l = await db.lemmas.where('lemma').equals(lemma).first()
    if (!l) return null
    const examples = await lemmaExamples(l)
    const forms = await db.formIndex.where('lemmaId').equals(l.id).toArray()
    const c = await db.cards.get(lemmaCardId(l.key))
    const card = isLive(c) ? c : null
    const gl = mergeGlosses(l.glosses, await userGlossTexts(l.key))
    // Did you mean: other lemmas the SEARCHED form itself maps to (never the lemma's other forms).
    const others = hl && !locState?.fromReview ? (await rankForm(hl)).filter(r => r.l.id !== l.id) : []
    return { l, examples, forms, card, gl, others }
  }, [lemma, id, hl, !!locState?.fromReview])

  const lemmaId = data?.l.id
  const lemmaKey = data?.l.key
  useEffect(() => { if (lemmaKey) void addRecentLemma({ key: lemmaKey }) }, [lemmaKey])
  const nEx = data?.examples.length
  const shuffled = useMemo<Ex[]>(() => {
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
      const code = (tagsOf.get(f) ?? []).find(x => labelTag(x))
      const grp: TagGroup = code ? groupOf(code) : 'Forme'
      g.set(grp, [...(g.get(grp) ?? []), [f, n]])
    }
    return GROUPS.filter(x => g.has(x)).map(x => [x, g.get(x)!] as const)
  }, [data?.examples, tagsOf])

  if (data === undefined) return null
  if (data === null) return <><h1>{lemma}</h1><p className="muted">Not found.</p></>
  const { l, card, gl: merged, others } = data
  const active = chip && data.examples.some(e => e.form === chip) ? chip : null
  const shown = active ? shuffled.filter(e => e.form === active) : shuffled
  const all = [...merged.dict, ...merged.user]
  const gl = moreGl ? all : [...merged.dict.slice(0, 3), ...merged.user.slice(0, 3)]
  return (
    <>
      {locState?.fromReview && <button className="link" onClick={() => nav(-1)}>← Back to review</button>}
      <h1>{l.lemma} <Speak text={l.lemma} /></h1>
      <p className="muted"><span className="tag">{posLabel(l.pos)}</span> {gl.join('; ')}
        {all.length > gl.length || moreGl ? <> <button className="link" onClick={() => setMoreGl(!moreGl)}>{moreGl ? 'less' : `more (${all.length - gl.length})`}</button></> : null}
      </p>
      {others.length > 0 && (
        <p className="muted also" data-testid="didyoumean">Did you mean: {others.map((r, i) => {
          const lab = formLabel(r, hl)
          return (
            <span key={r.l.id}>{i > 0 && ', '}<Link to={wordUrl(r.l, hl)} state={{ form: hl }}>{r.l.lemma}</Link> ({posLabel(r.l.pos)}{lab ? `, ${lab}` : ''})</span>
          )
        })}?</p>
      )}
      <CardControls cardRef={{ lemmaKey: l.key }} card={card} />
      {l.pos === 'verb' && <ConjugationTable forms={data.forms} highlight={hl} />}
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
      {shown.map(e => (
        <div key={e.id} className="card">
          <ExLine text={e.it} form={e.form} />
          <div className="muted">{e.en}</div>
        </div>
      ))}
    </>
  )
}
