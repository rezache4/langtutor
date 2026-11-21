import { useRef, useState } from 'react'
import { db, setSetting } from '../db/schema'
import { DEFAULTS, useSettings } from '../lib/settings'
import AccountCard from './AccountCard'
import { upgradeExport } from '../lib/legacy'
import { importReverso, type ImportSummary } from '../lib/reverso'

const opts = (list: number[], cur: number) => (list.includes(cur) ? list : [...list, cur].sort((a, b) => a - b))

export default function Settings() {
  const st = useSettings() ?? DEFAULTS
  const file = useRef<HTMLInputElement>(null)
  const csv = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [rv, setRv] = useState<{ busy?: string; err?: string; sum?: ImportSummary } | null>(null)

  async function doExport() {
    const data = {
      app: 'langtutor', exportedAt: new Date().toISOString(),
      cards: await db.cards.toArray(),
      reviewLog: await db.reviewLog.toArray(),
      settings: await db.settings.toArray(),
      userEntries: await db.userEntries.toArray(),
      userExamples: await db.userExamples.toArray(),
      userGlosses: await db.userGlosses.toArray(),
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `langtutor-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function doImport(f: File) {
    try {
      const d = JSON.parse(await f.text())
      if (d.app !== 'langtutor' || !Array.isArray(d.cards) || !Array.isArray(d.reviewLog) || !Array.isArray(d.settings))
        throw new Error('Not a LangTutor export')
      const now = Date.now()
      // Older exports refer to lemmas by build-local numeric id: resolve them through the current dictionary.
      const up = await upgradeExport(d, async id => (await db.lemmas.get(id))?.key, now)
      const cards = up.cards, logs = up.reviewLog
      const sets = d.settings.map((x: Record<string, unknown>) => ({ ...x, updatedAt: x.updatedAt ?? now }))
      await db.transaction('rw', [db.cards, db.reviewLog, db.settings, db.userEntries, db.userExamples, db.userGlosses], async () => {
        await db.cards.bulkPut(cards as never[])
        await db.reviewLog.bulkPut(logs as never[])
        await db.settings.bulkPut(sets)
        await db.userEntries.bulkPut(d.userEntries ?? [])
        await db.userExamples.bulkPut(up.userExamples as never[])
        await db.userGlosses.bulkPut(up.userGlosses as never[])
      })
      setMsg(`Imported ${cards.length} cards, ${logs.length} reviews.` + (up.dropped ? ` Skipped ${up.dropped} that no longer match the dictionary.` : ''))
    } catch (e) {
      setMsg('Import failed: ' + (e as Error).message)
    }
  }

  async function doReverso(f: File) {
    setRv({ busy: 'Reading…' })
    try {
      const sum = await importReverso(await f.text(), (n, t) => setRv({ busy: `Importing ${n} / ${t}…` }))
      setRv({ sum })
    } catch (e) {
      setRv({ err: (e as Error).message })
    }
  }

  return (
    <>
      <h1>Settings</h1>
      <div className="card settings">
        <label>
          New cards per day
          <select value={st.newPerDay} onChange={e => setSetting('newPerDay', Number(e.target.value))}>
            {opts([0, 5, 10, 15, 20, 30, 50], st.newPerDay).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Session size (cards)
          <select value={st.sessionSize} onChange={e => setSetting('sessionSize', Number(e.target.value))}>
            {opts([10, 20, 30, 50, 100], st.sessionSize).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Card front
          <select value={st.frontMode} onChange={e => setSetting('frontMode', e.target.value)}>
            <option value="sentence">Example sentence</option>
            <option value="lemma">Bare lemma</option>
          </select>
        </label>
        <label>
          Audio
          <select value={st.audioMode} onChange={e => setSetting('audioMode', e.target.value)}>
            <option value="off">Off</option>
            <option value="tap">Tap to play</option>
            <option value="auto">Auto-play</option>
          </select>
        </label>
        <label>
          Desired retention
          <select value={st.desiredRetention} onChange={e => setSetting('desiredRetention', Number(e.target.value))}>
            {opts([0.8, 0.85, 0.9, 0.95, 0.97], st.desiredRetention).map(n => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}
          </select>
        </label>
      </div>
      <div className="card">
        <div className="row">
          <button onClick={doExport}>Export JSON</button>
          <button onClick={() => file.current?.click()}>Import JSON</button>
          <input ref={file} type="file" accept="application/json" hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
        </div>
        {msg && <p>{msg}</p>}
      </div>
      <div className="card" data-testid="reverso">
        <h2>Reverso favorites</h2>
        <div className="row">
          <button onClick={() => csv.current?.click()} disabled={!!rv?.busy}>Import Reverso favorites (CSV)</button>
          <input ref={csv} type="file" accept=".csv,text/csv" hidden data-testid="reverso-file"
            onChange={e => { const f = e.target.files?.[0]; if (f) void doReverso(f); e.target.value = '' }} />
        </div>
        {rv?.busy && <p className="muted">{rv.busy}</p>}
        {rv?.err && <p>Import failed: {rv.err}</p>}
        {rv?.sum && (
          <div data-testid="reverso-summary">
            <p><strong>Import finished</strong> · {rv.sum.rows} rows</p>
            <ul className="rv-gl">
              <li><strong>{rv.sum.words}</strong> words added (not in the dictionary)</li>
              <li><strong>{rv.sum.linked}</strong> linked to a dictionary lemma</li>
              <li><strong>{rv.sum.phrases}</strong> phrases added</li>
              <li><strong>{rv.sum.skipped}</strong> skipped (already imported, repeated or empty)</li>
            </ul>
            <small className="muted">{rv.sum.newCards} new cards created.</small>
          </div>
        )}
      </div>
      <AccountCard />
      <div className="card">
        <h2>About / Credits</h2>
        <p>Example sentences: <a href="https://tatoeba.org" target="_blank" rel="noreferrer">Tatoeba</a>, licensed CC BY 2.0 FR.</p>
        <p>Dictionary data: <a href="https://en.wiktionary.org" target="_blank" rel="noreferrer">Wiktionary</a> via <a href="https://kaikki.org" target="_blank" rel="noreferrer">kaikki.org</a> / wiktextract, licensed CC BY-SA 4.0.</p>
      </div>
    </>
  )
}
