import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Search from './pages/Search'
import Word from './pages/Word'
import Entry from './pages/Entry'
import Review from './pages/Review'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import { useEffect, useRef, useState } from 'react'
import { loadBundle, type Progress } from './data/loader'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSettings } from './lib/settings'
import { availableCount } from './lib/queue'
import { startSync, syncNow, syncSoon } from './lib/sync'

const tabs = [
  { to: '/', label: 'Search', icon: '\u{1F50D}' },
  { to: '/review', label: 'Review', icon: '\u{1F0CF}' },
  { to: '/stats', label: 'Stats', icon: '\u{1F4CA}' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function App() {
  const [ready, setReady] = useState(false)
  const [prog, setProg] = useState<Progress | null>(null)
  useEffect(() => {
    let on = true
    loadBundle(p => { if (on) setProg(p) }).catch(() => { /* offline or no bundle */ }).finally(() => { void syncNow(); if (on) setReady(true) }) // a sync that ran before the dictionary was loaded could not repair old rows
    return () => { on = false }
  }, [])
  useEffect(() => { startSync() }, [])
  // Leaving the review screen = a session just ended: sync shortly after.
  const path = useLocation().pathname
  const prevPath = useRef(path)
  useEffect(() => { if (prevPath.current === '/review' && path !== '/review') syncSoon(3000); prevPath.current = path }, [path])
  const settings = useSettings()
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30_000); return () => clearInterval(t) }, [])
  const due = useLiveQuery(async () => (ready && settings ? availableCount(settings) : 0), [ready, settings?.newPerDay, settings?.sessionSize, tick]) ?? 0
  if (!ready) return (
    <div className="splash">
      <h1>LangTutor</h1>
      {prog ? <>
        <p>{prog.phase === 'download' ? 'Downloading dictionary…' : 'Importing…'} {prog.pct}%</p>
        <div className="bar"><div style={{ width: prog.pct + '%' }} /></div>
      </> : <p className="muted">Loading…</p>}
    </div>
  )
  return (
    <div className="app">
      <main>
        <Routes>
          <Route path="/" element={<Search />} />
          <Route path="/word/:lemma" element={<Word />} />
          <Route path="/entry/:id" element={<Entry />} />
          <Route path="/review" element={<Review />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <nav className="tabbar">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span aria-hidden className="ico">{t.icon}{t.to === '/review' && due > 0 && <i className="badge" data-testid="badge">{due > 99 ? '99+' : due}</i>}</span>
            <small>{t.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
