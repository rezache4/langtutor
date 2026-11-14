import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getDeviceId } from '../db/schema'
import { Rating, schedule, type Grade } from '../lib/fsrs'
import { speak } from '../lib/tts'

export default function Review() {
  const [show, setShow] = useState(false)
  const item = useLiveQuery(async () => {
    const c = await db.cards.where('due').belowOrEqual(Date.now()).first()
    if (!c) return null
    const l = await db.lemmas.get(c.lemmaId)
    const ex = await db.examples.where('lemmaId').equals(c.lemmaId).first()
    return { c, l, ex }
  }, [])

  async function rate(r: Grade) {
    if (!item) return
    const next = schedule(item.c, r)
    const deviceId = await getDeviceId()
    await db.transaction('rw', db.cards, db.reviewLog, async () => {
      await db.cards.put(next)
      await db.reviewLog.add({ id: crypto.randomUUID(), cardId: item.c.id, rating: r, reviewedAt: Date.now(), deviceId, synced: 0 })
    })
    setShow(false)
  }

  if (item === undefined) return null
  if (item === null) return <><h1>Review</h1><p className="muted">Nothing due. Add words from a word page.</p></>
  const ex = item.ex
  return (
    <>
      <h1>Review</h1>
      <div className="card">
        <h2>{item.l?.lemma}</h2>
        {ex && <p>{ex.it} <button onClick={() => speak(ex.it)}>Play</button></p>}
        {show
          ? <p className="muted">{item.l?.glosses.join('; ')}<br />{ex?.en}</p>
          : <button className="primary" onClick={() => setShow(true)}>Show answer</button>}
      </div>
      {show && (
        <div className="row">
          <button onClick={() => rate(Rating.Again)}>Again</button>
          <button onClick={() => rate(Rating.Hard)}>Hard</button>
          <button onClick={() => rate(Rating.Good)}>Good</button>
          <button onClick={() => rate(Rating.Easy)}>Easy</button>
        </div>
      )}
    </>
  )
}
