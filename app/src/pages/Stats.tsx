import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'

export default function Stats() {
  const s = useLiveQuery(async () => ({
    cards: await db.cards.count(),
    due: await db.cards.where('due').belowOrEqual(Date.now()).count(),
    reviews: await db.reviewLog.count(),
    lemmas: await db.lemmas.count(),
  }), [])
  return (
    <>
      <h1>Stats</h1>
      {s && (
        <div className="card">
          <div>Lemmas loaded: {s.lemmas}</div>
          <div>Cards: {s.cards}</div>
          <div>Due now: {s.due}</div>
          <div>Total reviews: {s.reviews}</div>
        </div>
      )}
    </>
  )
}
