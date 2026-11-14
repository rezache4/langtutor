import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Lemma, type UserEntry } from '../db/schema'
import { addCard, isLive, lemmaCardId } from '../lib/cards'
import { needsChooser, rankForm, wordUrl, type Ranked } from '../lib/lookup'
import { norm } from '../lib/userdata'

export default function Search() {
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [choices, setChoices] = useState<Ranked[]>([])
  const [entries, setEntries] = useState<UserEntry[]>([])
  const nav = useNavigate()
  const count = useLiveQuery(() => db.lemmas.count(), [])
  const inDeck = useLiveQuery(async () => new Set((await db.cards.filter(isLive).primaryKeys()) as string[]), [])

  const go = (l: Lemma, form: string) => nav(wordUrl(l, form), { state: { form } })

  async function onChange(v: string) {
    setQ(v)
    const f = norm(v)
    setChoices([])
    setEntries([])
    if (!f) { setMsg(''); return }
    // The user's own words and phrases (imported favorites etc.).
    const mine = (await db.userEntries.filter(e => !e.deleted && norm(e.text).includes(f)).toArray())
      .sort((a, b) => Number(norm(b.text) === f) - Number(norm(a.text) === f) || a.text.length - b.text.length)
      .slice(0, 8)
    setEntries(mine)
    const ranked = await rankForm(f)
    if (ranked.length === 1 || (ranked.length > 1 && !needsChooser(ranked))) { go(ranked[0].l, f); return }
    if (ranked.length > 1) {
      setMsg(`"${f}" matches ${ranked.length} words:`)
      setChoices(ranked)
      return
    }
    setMsg(mine.length ? '' : 'No exact match (keep typing).')
  }

  return (
    <>
      <h1>Search</h1>
      <input type="search" value={q} autoFocus placeholder="Type an Italian word form"
        autoCapitalize="none" autoCorrect="off" onChange={e => onChange(e.target.value)} />
      {count === 0 && <p className="muted">No data loaded yet.</p>}
      {msg && count !== 0 && <p className="muted">{msg}</p>}
      {choices.map(({ l }) => (
        <div key={l.id} className="card choice">
          <button className="choice-main" onClick={() => go(l, norm(q))}>
            <strong>{l.lemma}</strong> <span className="tag">{l.pos}</span>
            <div className="muted">{l.glosses.slice(0, 3).join('; ')}</div>
          </button>
          {inDeck?.has(lemmaCardId(l.id))
            ? <span className="muted choice-add">✓ In review</span>
            : <button className="choice-add" onClick={() => addCard({ lemmaId: l.id })}>+ Add</button>}
        </div>
      ))}
      {entries.length > 0 && <h2>Your words and phrases</h2>}
      {entries.map(e => (
        <div key={e.id} className="card choice">
          <Link className="choice-main" to={`/entry/${e.id}`}>
            <strong>{e.text}</strong> <span className="tag">{e.kind}</span>
            <div className="muted">{e.glosses.slice(0, 3).join('; ')}</div>
          </Link>
        </div>
      ))}
    </>
  )
}
