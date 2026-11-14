import { useEffect, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Lemma, type UserEntry } from '../db/schema'
import { addCard, isLive, lemmaCardId } from '../lib/cards'
import { fold, needsChooser, rankForm, suggest, wordUrl, type Ranked, type Suggestion } from '../lib/lookup'
import { norm } from '../lib/userdata'

export default function Search() {
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [sel, setSel] = useState(-1)
  const [choices, setChoices] = useState<Ranked[]>([])
  const [entries, setEntries] = useState<UserEntry[]>([])
  const nav = useNavigate()
  const count = useLiveQuery(() => db.lemmas.count(), [])
  const inDeck = useLiveQuery(async () => new Set((await db.cards.filter(isLive).primaryKeys()) as string[]), [])

  const go = (l: Lemma, form: string) => nav(wordUrl(l, form), { state: { form } })

  const pickSuggestion = (s: Suggestion) => {
    if (s.kind === 'lemma') go(s.l, s.form)
    else nav(`/entry/${s.entry.id}`)
  }

  useEffect(() => {
    const f = norm(q)
    setSel(-1)
    if (!f) {
      setSuggestions([])
      setChoices([])
      setEntries([])
      setMsg('')
      return
    }
    let active = true
    const timer = setTimeout(async () => {
      const list = await suggest(f, 10)
      if (!active) return
      setSuggestions(list)
      setMsg(list.length ? '' : 'No matches found.')
    }, 120)
    return () => { active = false; clearTimeout(timer) }
  }, [q])

  function onChange(v: string) {
    setQ(v)
    setChoices([])
    setEntries([])
    if (!norm(v)) {
      setSuggestions([])
      setMsg('')
    }
  }

  async function onSubmit() {
    if (sel >= 0 && suggestions[sel]) {
      pickSuggestion(suggestions[sel])
      return
    }
    const f = norm(q)
    if (!f) return
    const mine = (await db.userEntries.filter(e => !e.deleted && fold(e.text).includes(fold(f))).toArray())
      .sort((a, b) => Number(fold(b.text) === fold(f)) - Number(fold(a.text) === fold(f)) || a.text.length - b.text.length)
      .slice(0, 8)
    setEntries(mine)
    const ranked = await rankForm(f)
    const matchedForm = suggestions.find(s => s.kind === 'lemma' && fold(s.form) === fold(f))?.form ?? f
    if (ranked.length === 1 || (ranked.length > 1 && !needsChooser(ranked))) {
      go(ranked[0].l, matchedForm)
      return
    }
    if (ranked.length > 1) {
      setMsg(`"${matchedForm}" matches ${ranked.length} words:`)
      setChoices(ranked)
      return
    }
    if (mine.length === 1 && fold(mine[0].text) === fold(f)) {
      nav(`/entry/${mine[0].id}`)
      return
    }
    if (suggestions.length > 0) {
      pickSuggestion(suggestions[0])
      return
    }
    setMsg(mine.length ? '' : 'No exact match (keep typing).')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (!suggestions.length) return
      e.preventDefault()
      setSel(i => (i + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      if (!suggestions.length) return
      e.preventDefault()
      setSel(i => (i <= 0 ? suggestions.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void onSubmit()
    }
  }

  return (
    <>
      <h1>Search</h1>
      <input type="search" value={q} autoFocus placeholder="Type an Italian word form"
        autoCapitalize="none" autoCorrect="off"
        onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown} />
      {count === 0 && <p className="muted">No data loaded yet.</p>}
      {suggestions.length > 0 && (
        <div className="ac-list" role="listbox" data-testid="suggestions">
          {suggestions.map((s, i) => (
            <button
              key={s.kind === 'lemma' ? `l-${s.l.id}` : `e-${s.entry.id}`}
              type="button"
              role="option"
              aria-selected={i === sel}
              className={'ac-row' + (i === sel ? ' active' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => pickSuggestion(s)}
            >
              {s.kind === 'lemma' ? (
                <>
                  <span className="ac-form">{s.form}</span>
                  <span className="ac-arrow muted" aria-hidden="true">→</span>
                  <span className="ac-lemma">{s.l.lemma}</span>
                  <span className="tag">{s.l.pos}</span>
                  {s.label && <span className="ac-label muted">{s.label}</span>}
                </>
              ) : (
                <>
                  <span className="ac-form">{s.entry.text}</span>
                  <span className="ac-arrow muted" aria-hidden="true">→</span>
                  <span className="ac-lemma">{s.entry.glosses[0] ?? s.entry.text}</span>
                  <span className="tag">{s.entry.kind}</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}
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
