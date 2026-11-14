import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Lemma } from '../db/schema'

export default function Search() {
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [choices, setChoices] = useState<{ l: Lemma; form: string }[]>([])
  const nav = useNavigate()
  const count = useLiveQuery(() => db.lemmas.count(), [])

  const go = (l: Lemma, form: string) =>
    nav(`/word/${encodeURIComponent(l.lemma)}?id=${l.id}&form=${encodeURIComponent(form)}`, { state: { form } })

  async function onChange(v: string) {
    setQ(v)
    const f = v.trim().toLowerCase()
    setChoices([])
    if (!f) { setMsg(''); return }
    const hits = await db.formIndex.where('form').equals(f).toArray()
    const ids = [...new Set(hits.map(h => h.lemmaId))]
    const lemmas = (await db.lemmas.bulkGet(ids)).filter((l): l is Lemma => !!l)
    if (lemmas.length === 1) { go(lemmas[0], f); return }
    if (lemmas.length > 1) {
      setMsg(`"${f}" matches ${lemmas.length} words:`)
      setChoices(lemmas.map(l => ({ l, form: f })))
      return
    }
    setMsg('No exact match (keep typing).')
  }

  return (
    <>
      <h1>Search</h1>
      <input type="search" value={q} autoFocus placeholder="Type an Italian word form"
        autoCapitalize="none" autoCorrect="off" onChange={e => onChange(e.target.value)} />
      {count === 0 && <p className="muted">No data loaded yet.</p>}
      {msg && count !== 0 && <p className="muted">{msg}</p>}
      {choices.map(({ l, form }) => (
        <button key={l.id} className="card choice" onClick={() => go(l, form)}>
          <strong>{l.lemma}</strong> <span className="tag">{l.pos}</span>
          <div className="muted">{l.glosses.slice(0, 3).join('; ')}</div>
        </button>
      ))}
    </>
  )
}
