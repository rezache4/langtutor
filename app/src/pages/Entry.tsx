import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { db, type Ex } from '../db/schema'
import { ExLine, Speak } from '../lib/ui'
import { isLive, softDeleteEntry } from '../lib/cards'
import { CardControls } from '../lib/CardControls'
import { entryExamples } from '../lib/userdata'

/** Page of a user's own word or phrase (imported favorites); mirrors the word page. */
export default function Entry() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const fromReview = (useLocation().state as { fromReview?: boolean } | null)?.fromReview
  const data = useLiveQuery(async () => {
    const e = await db.userEntries.get(id)
    if (!e || e.deleted) return null
    const c = await db.cards.get(`e${id}`)
    return { e, card: isLive(c) ? c : null }
  }, [id])
  const [examples, setExamples] = useState<Ex[] | null>(null)
  useEffect(() => {
    let on = true
    setExamples(null)
    void db.userEntries.get(id).then(async e => {
      const ex = e && !e.deleted ? await entryExamples(e) : []
      if (on) setExamples(ex)
    })
    return () => { on = false }
  }, [id])

  if (data === undefined) return null
  if (data === null) return <><h1>Entry</h1><p className="muted">Not found.</p></>
  const { e, card } = data
  return (
    <>
      {fromReview && <button className="link" onClick={() => nav(-1)}>← Back to review</button>}
      <h1>{e.text} <Speak text={e.text} /></h1>
      <p className="muted"><span className="tag">{e.kind}</span> {e.glosses.join('; ')}</p>
      <CardControls cardRef={{ entryId: e.id }} card={card} />
      <h2>Examples{examples ? ` (${examples.length})` : ''}</h2>
      {examples === null && <p className="muted">Searching the example corpus…</p>}
      {examples?.length === 0 && <p className="muted">No examples.</p>}
      {examples?.map(x => (
        <div key={x.id} className="card">
          <ExLine text={x.it} form={x.form} />
          <div className="muted">{x.en}</div>
          {x.user && <small className="subtle">From your Reverso favorites</small>}
        </div>
      ))}
      <p><button className="link" onClick={async () => { await softDeleteEntry(e.id); nav('/') }}>Delete this entry</button></p>
    </>
  )
}
