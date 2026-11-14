import { NavLink, Route, Routes } from 'react-router-dom'
import Search from './pages/Search'
import Word from './pages/Word'
import Review from './pages/Review'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import { useEffect, useState } from 'react'
import { loadBundle, type Progress } from './data/loader'

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
    loadBundle(p => { if (on) setProg(p) }).catch(() => { /* offline or no bundle */ }).finally(() => { if (on) setReady(true) })
    return () => { on = false }
  }, [])
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
          <Route path="/review" element={<Review />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <nav className="tabbar">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span aria-hidden>{t.icon}</span>
            <small>{t.label}</small>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
