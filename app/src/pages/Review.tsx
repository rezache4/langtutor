import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db, getDeviceId, type CardRow, type Ex, type Form } from '../db/schema'
import { GRADES, preview, Rating, type Grade } from '../lib/fsrs'
import { speakAuto } from '../lib/tts'
import { loadSettings, useSettings, type AppSettings } from '../lib/settings'
import { buildQueue } from '../lib/queue'
import { fmtInterval, relDue, nextReviewText } from '../lib/time'
import { groupForms, labelsOf } from '../lib/tags'
import { CLAMP_LEN, ExLine, Speak } from '../lib/ui'
import { isActive, putCard } from '../lib/cards'
import { entryExamples, lemmaExamples, mergeGlosses, userGlossTexts } from '../lib/userdata'

const LABEL: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const RECENT = 12
const TOAST_MS = 4000

interface Undo { prev: CardRow; logId?: string; idx: number; requeued: boolean; rating?: Grade; msg: string; at: number; gen: number }
interface Session {
  queue: string[]; idx: number; gen: number; reviewed: number
  counts: Record<number, number>
  phase: 'front' | 'reveal'
  open: boolean // Details expanded on the back
  again: boolean // Again pressed: Details forced open, waiting for Next
  exId?: number | string // example chosen for the current card (kept so the card is stable across navigation)
  spoken: number
  undo: Undo | null
}
// Lives at module level so the session survives a trip to the full word page and back.
let session: Session | null = null
let building = false

interface Cur {
  gen: number; card: CardRow
  title: string; pos?: string
  glosses: { dict: string[]; user: string[] }
  ex?: Ex; others: Ex[]; forms: Form[]
  prev: Record<Grade, CardRow>
  to: string // full page (word or entry)
}

/** Random example, preferring <= 140 chars, never the one shown last time, biased towards ones not seen recently. */
export function pickExample(examples: Ex[], card: CardRow): Ex | undefined {
  if (!examples.length) return undefined
  const short = examples.filter(e => e.it.length <= CLAMP_LEN)
  const src = short.length ? short : examples
  if (src.length <= 1) return src[0]
  const hist = card.seenExamples ?? (card.lastExampleId ? [card.lastExampleId] : [])
  const nonLast = src.filter(e => e.id !== card.lastExampleId)
  const pool = nonLast.length ? nonLast : src
  const weight = (e: Ex) => {
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

const fresh = (queue: string[]): Session =>
  ({ queue, idx: 0, gen: 0, reviewed: 0, counts: { 1: 0, 2: 0, 3: 0, 4: 0 }, phase: 'front', open: false, again: false, spoken: -1, undo: null })

async function loadCur(S: Session, s: AppSettings): Promise<Cur | 'gone'> {
  const card = await db.cards.get(S.queue[S.idx])
  if (!isActive(card)) return 'gone' // deleted, suspended or missing meanwhile
  let title: string, pos: string | undefined, glosses: Cur['glosses'], examples: Ex[], forms: Form[] = [], to: string
  if (card.lemmaKey != null) {
    const lemma = await db.lemmas.where('key').equals(card.lemmaKey).first()
    if (!lemma) return 'gone'
    title = lemma.lemma; pos = lemma.pos
    glosses = mergeGlosses(lemma.glosses, await userGlossTexts(lemma.key))
    examples = await lemmaExamples(lemma)
    forms = await db.formIndex.where('lemmaId').equals(lemma.id).toArray()
    to = `/word/${encodeURIComponent(lemma.lemma)}?id=${lemma.id}`
  } else {
    const entry = card.entryId ? await db.userEntries.get(card.entryId) : undefined
    if (!entry || entry.deleted) return 'gone'
    title = entry.text; pos = entry.kind
    glosses = { dict: [], user: entry.glosses }
    examples = await entryExamples(entry)
    to = `/entry/${entry.id}`
  }
  let ex = S.exId != null ? examples.find(e => e.id === S.exId) : undefined
  if (!ex) { ex = pickExample(examples, card); S.exId = ex?.id }
  const rest = examples.filter(e => e.id !== ex?.id)
  const others = sample(rest, Math.min(rest.length, 3 + Math.floor(Math.random() * 3)))
  return { gen: S.gen, card, title, pos, glosses, ex, others, forms, to, prev: preview(card, new Date(), s.desiredRetention) }
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
      if (c === 'gone') { cs.idx++; cs.exId = undefined; cs.undo = null; cs.gen++; bump(); return } // card deleted meanwhile
      setCur(c)
    })
    return () => { on = false }
  }, [S?.gen, S?.queue, !!settings]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss undo toast after 4s.
  useEffect(() => {
    const u = S?.undo
    if (!u) return
    const ms = Math.max(0, TOAST_MS - (Date.now() - u.at))
    const t = setTimeout(() => {
      if (session?.undo === u) { session.undo = null; bump() }
    }, ms)
    return () => clearTimeout(t)
  }, [S?.undo])

  // End / empty screen info.
  useEffect(() => {
    if (!done) return
    void db.cards.where('due').above(Date.now()).filter(isActive).first().then(c => setNextDue(c ? c.due : null))
    void db.cards.filter(c => !c.deleted).count().then(setDeckSize)
  }, [done, S?.gen])

  const ok = !!S && !!cur && cur.gen === S.gen && !done
  const front = settings?.frontMode ?? 'sentence'

  // Auto-play: only when audioMode is 'auto' (speakAuto checks the stored setting itself). Once per card display.
  useEffect(() => {
    if (!ok || !S || !cur || S.phase !== 'front' || S.spoken === S.gen) return
    S.spoken = S.gen
    const text = front === 'lemma' || !cur.ex ? cur.title : cur.ex.it
    void speakAuto(text)
  }, [ok, cur, front]) // eslint-disable-line react-hooks/exhaustive-deps

  function reveal() { if (session) { session.phase = 'reveal'; session.open = false; session.again = false; bump() } }
  function toggleDetails() { if (session && !session.again) { session.open = !session.open; if (session.open) session.undo = null; bump() } }
  const advance = (cs: Session, nextUndo: Undo | null = null) => {
    cs.idx++; cs.phase = 'front'; cs.open = false; cs.again = false; cs.exId = undefined; cs.gen++; cs.undo = nextUndo
    setCur(null); bump()
  }

  /** Rate the current card. `label` replaces the toast label (used by "I know it"). */
  async function rate(r: Grade, label = LABEL[r]) {
    const cs = session
    if (!cs || !cur || cur.gen !== cs.gen || busy.current) return
    busy.current = true
    try {
      const now = Date.now()
      const exId = cur.ex?.id
      const next: CardRow = {
        ...cur.prev[r],
        lastExampleId: exId ?? cur.card.lastExampleId,
        seenExamples: exId != null ? [...(cur.card.seenExamples ?? []).filter(x => x !== exId), exId].slice(-RECENT) : cur.card.seenExamples,
        updatedAt: now,
      }
      const logId = crypto.randomUUID()
      const deviceId = await getDeviceId()
      await db.transaction('rw', db.cards, db.reviewLog, async () => {
        await db.cards.put(next)
        await db.reviewLog.add({ id: logId, cardId: cur.card.id, rating: r, reviewedAt: now, deviceId, synced: 0, due: next.due, state: cur.card.state, updatedAt: now })
      })
      cs.counts[r]++
      cs.reviewed++
      const requeue = next.state !== 2 && next.due - now < 10 * 60_000 // still (re)learning: see it again this session
      if (requeue) cs.queue.push(next.id)
      const nextUndo: Undo = { prev: cur.card, logId, idx: cs.idx, requeued: requeue, rating: r, msg: `${label} · next review ${relDue(next.due, now)}`, at: now, gen: cs.gen + 1 }
      advance(cs, nextUndo)
    } finally { busy.current = false }
  }

  /** Mark as known: suspend the card and move on (not counted as a review). */
  async function markKnown() {
    const cs = session
    if (!cs || !cur || cur.gen !== cs.gen || busy.current) return
    busy.current = true
    try {
      await putCard({ ...cur.card, suspended: 1 })
      const nextUndo: Undo = { prev: cur.card, idx: cs.idx, requeued: false, msg: `Marked “${cur.title}” as known · won’t be reviewed`, at: Date.now(), gen: cs.gen + 1 }
      advance(cs, nextUndo)
    } finally { busy.current = false }
  }

  async function undo() {
    const cs = session
    const u = cs?.undo
    if (!cs || !u || busy.current) return
    busy.current = true
    try {
      await db.transaction('rw', db.cards, db.reviewLog, async () => {
        await db.cards.put({ ...u.prev, updatedAt: Date.now() })
        if (u.logId) await db.reviewLog.update(u.logId, { deleted: 1, updatedAt: Date.now() }) // soft delete
      })
      if (u.rating) { cs.counts[u.rating]--; cs.reviewed-- }
      if (u.requeued) cs.queue.pop()
      cs.idx = u.idx; cs.phase = 'front'; cs.open = false; cs.again = false; cs.exId = undefined; cs.undo = null; cs.gen++
      setCur(null)
      bump()
    } finally { busy.current = false }
  }

  if (!settings || !S) return <><h1>Review</h1><p className="muted">Loading…</p></>

  const undoBar = S.undo && (
    <div className="rv-undo" data-testid="undo-toast">
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

  const { ex, card, title, pos } = cur
  const showSentence = front === 'sentence' && !!ex
  const formTags = ex && cur.forms.length
    ? [...new Set(labelsOf(cur.forms.filter(f => f.form === ex.form).map(f => f.tags).join(' | ')))].slice(0, 2)
    : []
  const header = (
    <div className="rv-head">
      <span className="rv-progress">{Math.min(S.idx + 1, S.queue.length)} / {S.queue.length}</span>
      <div className="bar rv-bar"><div style={{ width: (S.idx / S.queue.length) * 100 + '%' }} /></div>
      <button className="link" onClick={() => { S.idx = S.queue.length; S.undo = null; S.gen++; bump() }}>End</button>
    </div>
  )
  const sentenceBlock = ex && (
    <>
      <ExLine className="rv-sentence" text={ex.it} form={ex.form} />
      <div className="muted rv-en">{ex.en}</div>
    </>
  )
  const backGlosses = [...cur.glosses.dict.slice(0, 3), ...cur.glosses.user.slice(0, 3)]
  const detailsOpen = S.phase === 'reveal' && (S.open || S.again)
  const groups = detailsOpen ? groupForms(cur.forms) : []
  const isLemma = card.lemmaKey != null

  return (
    <>
      <div className="rv-wrap">
        {header}
        <div className="card rv-card">
          {S.phase === 'front' ? (
            showSentence ? (
              <>
                <ExLine className="rv-sentence" text={ex!.it} form={ex!.form} />
                <p className="rv-prompt">What does <strong>{ex!.form}</strong> mean here?</p>
              </>
            ) : (
              <>
                <div className="rv-lemma">{title} <Speak text={title} /></div>
                <p className="rv-prompt">What does <strong>{title}</strong> mean?</p>
              </>
            )
          ) : (
            <>
              {sentenceBlock}
              <hr />
              <div className="rv-lemma-sm">{title} <Speak text={title} /> {pos && <span className="tag">{pos}</span>}</div>
              <div className="rv-gloss">{backGlosses.join('; ')}</div>
              {formTags.length > 0 && <small className="subtle">{ex!.form}: {formTags.join(' / ')}</small>}
              <div className="muted rv-next">{nextReviewText(card)}</div>
              <button className="link rv-details-toggle" aria-expanded={detailsOpen} disabled={S.again} onClick={toggleDetails}>
                Details {detailsOpen ? '▴' : '▾'}
              </button>
            </>
          )}
        </div>
        {detailsOpen && (
          <div className="rv-details" data-testid="details">
            <div className="card">
              <h2>All meanings</h2>
              <ul className="rv-gl">
                {cur.glosses.dict.map((g, i) => <li key={'d' + i}>{g}</li>)}
                {cur.glosses.user.map((g, i) => <li key={'u' + i}>{g} <small className="subtle">· yours</small></li>)}
              </ul>
            </div>
            {cur.others.length > 0 && (
              <div className="card">
                <h2>More examples</h2>
                {cur.others.map(o => (
                  <div key={o.id} className="rv-other">
                    <ExLine text={o.it} form={o.form} />
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
            <p><Link to={cur.to + (isLemma && ex ? `&form=${encodeURIComponent(ex.form)}` : '')}
              state={{ fromReview: true, form: ex?.form }}>Open the full {isLemma ? 'word' : 'entry'} page →</Link></p>
            <p><button className="link" onClick={markKnown}>Mark as known (stop reviewing)</button></p>
          </div>
        )}
        {!detailsOpen && undoBar}
      </div>
      <div className="rv-actions">
        {S.phase === 'front' ? (
          <>
            <button className="rv-big" onClick={() => rate(Rating.Easy, 'Known · Easy')}>I know it ✓</button>
            <button className="rv-big primary" onClick={reveal}>Show answer</button>
          </>
        ) : S.again ? (
          <button className="rv-big primary" onClick={() => rate(Rating.Again)}>Next <small>counts as Again · {fmtInterval(cur.prev[Rating.Again].due - Date.now())}</small></button>
        ) : (
          GRADES.map(g => (
            <button key={g} className={'rv-rate r' + g}
              onClick={() => { if (g === Rating.Again) { S.again = true; S.undo = null; bump() } else void rate(g) }}>
              <span>{LABEL[g]}</span><small>{fmtInterval(cur.prev[g].due - Date.now())}</small>
            </button>
          ))
        )}
      </div>
      <div className="rv-spacer" />
    </>
  )
}
