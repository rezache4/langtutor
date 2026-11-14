import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db, getDeviceId, type CardRow, type Example, type Form, type Lemma } from '../db/schema'
import { GRADES, preview, Rating, type Grade } from '../lib/fsrs'
import { speakAuto } from '../lib/tts'
import { loadSettings, useSettings, type AppSettings } from '../lib/settings'
import { buildQueue } from '../lib/queue'
import { fmtInterval, relDue, nextReviewText } from '../lib/time'
import { groupForms, labelsOf } from '../lib/tags'
import { Highlighted, Speak } from '../lib/ui'

const LABEL: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const RECENT = 12

interface Undo { prev: CardRow; logId: string; idx: number; requeued: boolean; rating: Grade; msg: string }
interface Session {
  queue: number[]; idx: number; gen: number; reviewed: number
  counts: Record<number, number>
  phase: 'front' | 'reveal' | 'know'
  exId?: number // example chosen for the current card (kept so the card is stable across navigation)
  spoken: number
  undo: Undo | null
}
// Lives at module level so the session survives a trip to the full word page and back.
let session: Session | null = null
let building = false

interface Cur {
  gen: number; card: CardRow; lemma: Lemma; ex?: Example; others: Example[]; forms: Form[]
  prev: Record<Grade, CardRow>
}

/** Random example, never the one shown last time, biased towards ones not seen recently. */
export function pickExample(examples: Example[], card: CardRow): Example | undefined {
  if (examples.length <= 1) return examples[0]
  const hist = card.seenExamples ?? (card.lastExampleId ? [card.lastExampleId] : [])
  const pool = examples.filter(e => e.id !== card.lastExampleId)
  const weight = (e: Example) => {
    const i = hist.lastIndexOf(e.id)
    if (i < 0) return 1
    const age = hist.length - 1 - i // 0 = most recent
    return Math.min(0.9, 0.1 + 0.08 * age)
  }
  const ws = pool.map(weight)
  let r = Math.random() * ws.reduce((a, b) => a + b, 0)
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i] }
  return pool[pool.length - 1]
}

function sample<T>(a: T[], n: number): T[] {
  const r = a.slice()
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]] }
  return r.slice(0, n)
}

const fresh = (queue: number[]): Session =>
  ({ queue, idx: 0, gen: 0, reviewed: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0 }, phase: 'front', spoken: -1, undo: null })

async function loadCur(S: Session, s: AppSettings): Promise<Cur | 'gone'> {
  const id = S.queue[S.idx]
  const card = await db.cards.get(id)
  const lemma = await db.lemmas.get(id)
  if (!card || !lemma) return 'gone'
  const examples = await db.examples.where('lemmaId').equals(id).toArray()
  const forms = await db.formIndex.where('lemmaId').equals(id).toArray()
  let ex = S.exId ? examples.find(e => e.id === S.exId) : undefined
  if (!ex) { ex = pickExample(examples, card); S.exId = ex?.id }
  const rest = examples.filter(e => e.id !== ex?.id)
  const others = sample(rest, Math.min(rest.length, 3 + Math.floor(Math.random() * 3)))
  return { gen: S.gen, card, lemma, ex, others, forms, prev: preview(card, new Date(), s.desiredRetention) }
}

export default function Review() {
  const settings = useSettings()
  const nav = useNavigate()
  const [, setV] = useState(0)
  const bump = () => setV(v => v + 1)
  const [cur, setCur] = useState<Cur | null>(null)
  const [nextDue, setNextDue] = useState<number | null | undefined>(undefined)
  const [deckSize, setDeckSize] = useState<number | null>(null)
  const busy = useRef(false)
  const S = session

  async function start() {
    if (building) return
    building = true
    try {
      const s = await loadSettings()
      session = fresh(await buildQueue(s))
      setCur(null)
      bump()
    } finally { building = false }
  }

  useEffect(() => { if (!session) void start() }, [])
  useEffect(() => () => { if (session && session.idx >= session.queue.length) session = null }, [])

  // Load the card being shown.
  const done = !!S && S.idx >= S.queue.length
  useEffect(() => {
    const cs = session
    if (!cs || !settings || cs.idx >= cs.queue.length) { setCur(null); return }
    let on = true
    loadCur(cs, settings).then(c => {
      if (!on) return
      if (c === 'gone') { cs.idx++; cs.exId = undefined; cs.gen++; bump(); return } // card deleted meanwhile
      setCur(c)
    })
    return () => { on = false }
  }, [S?.gen, S?.queue, !!settings]) // eslint-disable-line react-hooks/exhaustive-deps

  // End / empty screen info.
  useEffect(() => {
    if (!done) return
    void db.cards.where('due').above(Date.now()).first().then(c => setNextDue(c ? c.due : null))
    void db.cards.count().then(setDeckSize)
  }, [done, S?.gen])

  const ok = !!S && !!cur && cur.gen === S.gen && !done
  const front = settings?.frontMode ?? 'sentence'

  // Auto-play: only when audioMode is 'auto' (speakAuto checks the stored setting itself). Once per card display.
  useEffect(() => {
    if (!ok || !S || !cur || S.phase !== 'front' || S.spoken === S.gen) return
    S.spoken = S.gen
    const text = front === 'lemma' || !cur.ex ? cur.lemma.lemma : cur.ex.it
    void speakAuto(text)
  }, [ok, cur, front]) // eslint-disable-line react-hooks/exhaustive-deps

  function phase(p: Session['phase']) { if (session) { session.phase = p; bump() } }

  async function rate(r: Grade) {
    const cs = session
    if (!cs || !cur || cur.gen !== cs.gen || busy.current) return
    busy.current = true
    try {
      const now = Date.now()
      const exId = cur.ex?.id
      const next: CardRow = {
        ...cur.prev[r],
        lastExampleId: exId ?? cur.card.lastExampleId,
        seenExamples: exId ? [...(cur.card.seenExamples ?? []).filter(x => x !== exId), exId].slice(-RECENT) : cur.card.seenExamples,
      }
      const logId = crypto.randomUUID()
      const deviceId = await getDeviceId()
      await db.transaction('rw', db.cards, db.reviewLog, async () => {
        await db.cards.put(next)
        await db.reviewLog.add({ id: logId, cardId: cur.card.id, rating: r, reviewedAt: now, deviceId, synced: 0, due: next.due, state: cur.card.state })
      })
      cs.counts[r]++
      cs.reviewed++
      const requeue = next.state !== 2 && next.due - now < 10 * 60_000 // still (re)learning: see it again this session
      if (requeue) cs.queue.push(next.id)
      cs.undo = { prev: cur.card, logId, idx: cs.idx, requeued: requeue, rating: r, msg: `${LABEL[r]} · next review ${relDue(next.due, now)}` }
      cs.idx++; cs.phase = 'front'; cs.exId = undefined; cs.gen++
      setCur(null)
      bump()
    } finally { busy.current = false }
  }

  async function undo() {
    const cs = session
    const u = cs?.undo
    if (!cs || !u || busy.current) return
    busy.current = true
    try {
      await db.transaction('rw', db.cards, db.reviewLog, async () => {
        await db.cards.put(u.prev)
        await db.reviewLog.delete(u.logId)
      })
      cs.counts[u.rating]--; cs.reviewed--
      if (u.requeued) cs.queue.pop()
      cs.idx = u.idx; cs.phase = 'front'; cs.exId = undefined; cs.undo = null; cs.gen++
      setCur(null)
      bump()
    } finally { busy.current = false }
  }

  if (!settings || !S) return <><h1>Review</h1><p className="muted">Loading…</p></>

  const undoBar = S.undo && (
    <div className="rv-undo">
      <span>{S.undo.msg}</span>
      <button className="link" onClick={undo}>Undo</button>
    </div>
  )

  if (done) {
    const total = S.reviewed
    return (
      <>
        <h1>{total ? 'Session complete' : 'Nothing to review'}</h1>
        {total > 0 && (
          <div className="card">
            <p><strong>{total}</strong> review{total === 1 ? '' : 's'}</p>
            <div className="rv-counts">
              {GRADES.map(g => <div key={g} className={'rv-count r' + g}><b>{S.counts[g]}</b><small>{LABEL[g]}</small></div>)}
            </div>
          </div>
        )}
        <p className="muted">
          {deckSize === 0 ? 'Your deck is empty. Add words from a word page or from search.'
            : nextDue === undefined ? '' : nextDue === null ? 'No upcoming reviews scheduled.' : `Next review: ${relDue(nextDue)}`}
        </p>
        {undoBar}
        <div className="rv-actions">
          <button className="rv-big" onClick={() => { session = null; void start() }}>Check for more</button>
          <button className="rv-big primary" onClick={() => nav('/')}>Search words</button>
        </div>
        <div className="rv-spacer" />
      </>
    )
  }

  if (!ok || !cur) return <><h1>Review</h1><p className="muted">Loading…</p></>

  const { lemma, ex, card } = cur
  const showSentence = front === 'sentence' && !!ex
  const formTags = ex
    ? [...new Set(labelsOf(cur.forms.filter(f => f.form === ex.form).map(f => f.tags).join(' | ')))].slice(0, 2)
    : []
  const header = (
    <div className="rv-head">
      <span className="rv-progress">{Math.min(S.idx + 1, S.queue.length)} / {S.queue.length}</span>
      <div className="bar rv-bar"><div style={{ width: (S.idx / S.queue.length) * 100 + '%' }} /></div>
      <button className="link" onClick={() => { S.idx = S.queue.length; S.gen++; bump() }}>End</button>
    </div>
  )
  const sentenceBlock = ex && (
    <>
      <div className="rv-sentence"><Highlighted text={ex.it} form={ex.form} /> <Speak text={ex.it} /></div>
      <div className="muted rv-en">{ex.en}</div>
    </>
  )

  // --- Don't-know panel ---
  if (S.phase === 'know') {
    const groups = groupForms(cur.forms)
    return (
      <>
        {header}
        <div className="card">
          <div className="rv-lemma-sm">{lemma.lemma} <Speak text={lemma.lemma} /> <span className="tag">{lemma.pos}</span></div>
          <ul className="rv-gl">{lemma.glosses.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
        {ex && <div className="card">{sentenceBlock}</div>}
        {cur.others.length > 0 && (
          <div className="card">
            <h2>More examples</h2>
            {cur.others.map(o => (
              <div key={o.id} className="rv-other">
                <div><Highlighted text={o.it} form={o.form} /> <Speak text={o.it} /></div>
                <div className="muted">{o.en}</div>
              </div>
            ))}
          </div>
        )}
        {groups.length > 0 && (
          <div className="card">
            <h2>Forms</h2>
            {groups.map(([g, fs]) => (
              <div key={g} className="rv-forms"><small className="muted">{g}</small> {fs.slice(0, 14).join(', ')}{fs.length > 14 ? ` +${fs.length - 14}` : ''}</div>
            ))}
          </div>
        )}
        <p><Link to={`/word/${encodeURIComponent(lemma.lemma)}?id=${lemma.id}${ex ? `&form=${encodeURIComponent(ex.form)}` : ''}`}
          state={{ fromReview: true, form: ex?.form }}>Open the full word page →</Link></p>
        {undoBar}
        <div className="rv-actions">
          <button className="rv-big primary" onClick={() => rate(Rating.Again)}>Next <small>counts as Again · {fmtInterval(cur.prev[Rating.Again].due - Date.now())}</small></button>
        </div>
        <div className="rv-spacer" />
      </>
    )
  }

  return (
    <>
      {header}
      <div className="card rv-card">
        {S.phase === 'front' ? (
          showSentence ? (
            <>
              <div className="rv-sentence"><Highlighted text={ex!.it} form={ex!.form} /> <Speak text={ex!.it} /></div>
              <p className="rv-prompt">What does <strong>{ex!.form}</strong> mean here?</p>
            </>
          ) : (
            <>
              <div className="rv-lemma">{lemma.lemma} <Speak text={lemma.lemma} /></div>
              <p className="rv-prompt">What does <strong>{lemma.lemma}</strong> mean?</p>
            </>
          )
        ) : (
          <>
            {sentenceBlock}
            <hr />
            <div className="rv-lemma-sm">{lemma.lemma} <Speak text={lemma.lemma} /> <span className="tag">{lemma.pos}</span></div>
            <div className="rv-gloss">{lemma.glosses.slice(0, 3).join('; ')}</div>
            {formTags.length > 0 && <small className="subtle">{ex!.form}: {formTags.join(' / ')}</small>}
            <div className="muted rv-next">{nextReviewText(card)}</div>
          </>
        )}
      </div>
      {undoBar}
      <div className="rv-actions">
        {S.phase === 'front' ? (
          <>
            <button className="rv-big" onClick={() => phase('know')}>Don’t know</button>
            <button className="rv-big primary" onClick={() => phase('reveal')}>Show answer</button>
          </>
        ) : (
          GRADES.map(g => (
            <button key={g} className={'rv-rate r' + g} onClick={() => rate(g)}>
              <span>{LABEL[g]}</span><small>{fmtInterval(cur.prev[g].due - Date.now())}</small>
            </button>
          ))
        )}
      </div>
      <div className="rv-spacer" />
    </>
  )
}
