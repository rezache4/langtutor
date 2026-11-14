import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Lemma } from '../db/schema'
import { newCard } from '../lib/fsrs'

interface Choice { l: Lemma; form: string; n: number; nForms: number } // n = example count

export default function Search() {
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [choices, setChoices] = useState<Choice[]>([])
  const nav = useNavigate()
  const count = useLiveQuery(() => db.lemmas.count(), [])
  const inDeck = useLiveQuery(async () => new Set(await db.cards.toCollection().primaryKeys()), [])

  const go = (l: Lemma, form: string, also: Lemma[] = []) =>
    nav(`/word/${encodeURIComponent(l.lemma)}?id=${l.id}&form=${encodeURIComponent(form)}${also.length ? `&also=${also.map(a => a.id).join(',')}` : ''}`, { state: { form } })

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
      // Rank by number of example sentences (ties, e.g. the dataset caps examples per lemma: by number of known forms); jump straight to a clear winner.
      const ranked: Choice[] = await Promise.all(lemmas.map(async l => ({ l, form: f, n: await db.examples.where('lemmaId').equals(l.id).count(), nForms: await db.formIndex.where('lemmaId').equals(l.id).count() })))
      ranked.sort((a, b) => b.n - a.n || b.nForms - a.nForms)
      const [top, second] = ranked
      const clear = top.n > 0 && (second.n === 0 || top.n >= 3 * second.n || (top.n === second.n && top.nForms >= 2 * second.nForms))
      if (clear) { go(top.l, f, ranked.slice(1).map(r => r.l)); return }
      setMsg(`"${f}" matches ${ranked.length} words:`)
      setChoices(ranked)
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
      {choices.map(({ l, form, n, nForms }) => (
        <div key={l.id} className="card choice">
          <button className="choice-main" onClick={() => go(l, form)}>
            <strong>{l.lemma}</strong> <span className="tag">{l.pos}</span> <small className="muted">{n} example{n === 1 ? '' : 's'} · {nForms} forms</small>
            <div className="muted">{l.glosses.slice(0, 3).join('; ')}</div>
          </button>
          {inDeck?.has(l.id)
            ? <span className="muted choice-add">✓ In review</span>
            : <button className="choice-add" onClick={() => db.cards.put(newCard(l.id))}>+ Add</button>}
        </div>
      ))}
    </>
  )
}
