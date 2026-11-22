import { useMemo, useState } from 'react'
import { conjugation } from './conjugation'

/** Collapsible conjugation table of a verb; `highlight` marks the form the user searched for. */
export function ConjugationTable({ forms, highlight }: { forms: { form: string; tags: string }[]; highlight?: string }) {
  const [open, setOpen] = useState(false)
  const sections = useMemo(() => conjugation(forms), [forms])
  if (!sections.length) return null
  return (
    <div className="conj" data-testid="conjugation">
      <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>Coniugazione {open ? '▴' : '▾'}</button>
      {open && sections.map(s => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <div className="conj-grid">
            {s.blocks.map(b => (
              <div key={b.title || s.title} className={'card conj-block' + (b.title ? '' : ' wide')}>
                {b.title && <strong className="conj-title">{b.title}</strong>}
                {b.rows.map(r => (
                  <div key={r.label} className="conj-row">
                    <span className="conj-pron">{r.label}</span>
                    <span>
                      {r.forms.length
                        ? r.forms.map((f, i) => <span key={f}>{i > 0 && ' / '}<span className={f === highlight ? 'conj-hit' : undefined}>{f}</span></span>)
                        : <span className="muted">–</span>}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
