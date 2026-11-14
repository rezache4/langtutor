import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { DAY, endOfDay, startOfDay } from '../lib/time'

function Bars({ data, labelEvery = 1, label }: { data: { n: number; day: number }[]; labelEvery?: number; label: (d: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.n))
  return (
    <div className="chart" role="img" aria-label="bar chart">
      {data.map((d, i) => (
        <div key={i} className="col">
          <span className="val">{d.n || ''}</span>
          <div className="barv" style={{ height: `calc((100% - 28px) * ${d.n / max})` }} />
          <small className="lbl">{i % labelEvery === 0 ? label(d.day) : ''}</small>
        </div>
      ))}
    </div>
  )
}

const STATES = ['New', 'Learning', 'Review', 'Relearning']

export default function Stats() {
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 60_000); return () => clearInterval(t) }, [])
  const s = useLiveQuery(async () => {
    const now = Date.now()
    const t0 = startOfDay(now)
    const cards = await db.cards.toArray()
    const logs = await db.reviewLog.where('reviewedAt').aboveOrEqual(t0 - 29 * DAY).toArray()
    const allReviews = await db.reviewLog.count()
    const learned = cards.filter(c => c.state !== 0)
    const forecast = Array.from({ length: 14 }, (_, i) => ({ n: 0, day: t0 + i * DAY }))
    for (const c of learned) {
      const i = Math.max(0, Math.round((startOfDay(c.due) - t0) / DAY))
      if (i < 14) forecast[i].n++
    }
    const perDay = Array.from({ length: 30 }, (_, i) => ({ n: 0, day: t0 - (29 - i) * DAY }))
    for (const l of logs) {
      const i = 29 - Math.round((t0 - startOfDay(l.reviewedAt)) / DAY)
      if (i >= 0 && i < 30) perDay[i].n++
    }
    const rv = await db.reviewLog.filter(l => l.state === 2).toArray()
    const byState = [0, 0, 0, 0]
    for (const c of cards) byState[c.state] = (byState[c.state] ?? 0) + 1
    return {
      total: cards.length,
      dueToday: learned.filter(c => c.due < endOfDay(now)).length,
      dueNow: learned.filter(c => c.due <= now).length,
      byState, forecast, perDay, allReviews,
      retention: rv.length ? Math.round((rv.filter(l => l.rating >= 3).length / rv.length) * 100) : null,
      rvN: rv.length,
      lemmas: await db.lemmas.count(),
    }
  }, [tick])
  const dayLbl = (d: number) => new Date(d).getDate().toString()
  return (
    <>
      <h1>Stats</h1>
      {s && (
        <>
          <div className="tiles">
            <div className="tile"><b>{s.dueToday}</b><small>due today</small></div>
            <div className="tile"><b>{s.dueNow}</b><small>due now</small></div>
            <div className="tile"><b>{s.retention === null ? '–' : s.retention + '%'}</b><small>retention</small></div>
          </div>
          <div className="card">
            <h2>Due forecast, next 14 days</h2>
            <Bars data={s.forecast} label={dayLbl} />
            <small className="muted">Today includes overdue cards.</small>
          </div>
          <div className="card">
            <h2>Cards ({s.total})</h2>
            <div className="states">
              {STATES.map((n, i) => <div key={n} className={'st s' + i}><b>{s.byState[i]}</b><small>{n.toLowerCase()}</small></div>)}
            </div>
          </div>
          <div className="card">
            <h2>Reviews per day, last 30 days</h2>
            <Bars data={s.perDay} labelEvery={5} label={dayLbl} />
            <small className="muted">{s.allReviews} reviews total</small>
          </div>
          <div className="card">
            <h2>Retention</h2>
            <p>{s.retention === null ? 'No review-state reviews yet.' : `${s.retention}% of ${s.rvN} reviews of mature cards were Good or Easy.`}</p>
          </div>
          <p className="muted">Lemmas loaded: {s.lemmas}</p>
        </>
      )}
    </>
  )
}
