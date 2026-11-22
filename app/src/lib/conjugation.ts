import { PERSONS, PRONOUN, codesOf } from './tags'

export interface ConjRow { label: string; forms: string[] }
export interface ConjBlock { title: string; rows: ConjRow[] }
export interface ConjSection { title: string; blocks: ConjBlock[] }

const FINITE: [mood: string, title: string, tenses: [code: string, title: string][]][] = [
  ['ind', 'Indicativo', [['pres', 'Presente'], ['impf', 'Imperfetto'], ['hist', 'Passato remoto'], ['fut', 'Futuro']]],
  ['sub', 'Congiuntivo', [['pres', 'Presente'], ['impf', 'Imperfetto']]],
]

/**
 * Simple-tense conjugation of a verb from the tags of its forms. Several forms may fill one slot (variants), and one form
 * may fill several slots (e.g. "andiamo" is present, subjunctive and imperative). Compound tenses are not in the data.
 */
export function conjugation(forms: { form: string; tags: string }[]): ConjSection[] {
  const slot = new Map<string, string[]>() // normalised tag code -> forms, in input order
  for (const f of forms) {
    for (const code of codesOf(f.tags)) {
      const list = slot.get(code) ?? []
      if (!list.includes(f.form)) list.push(f.form)
      slot.set(code, list)
    }
  }
  const get = (code: string) => slot.get(code) ?? []
  const persons = (prefix: string, which: readonly string[] = PERSONS): ConjRow[] => {
    const rows = which.map(p => ({ p, label: PRONOUN[p], forms: get(`${prefix}.${p}`) }))
    // The data often lacks the 3rd person singular of the present subjunctive although it equals the 1st and 2nd ("che io/tu/lui vada").
    const [a, b, c] = rows
    if (prefix === 'sub.pres' && which === PERSONS && !c.forms.length && a.forms.length && a.forms.join() === b.forms.join()) c.forms = [...a.forms]
    return rows.map(({ label, forms }) => ({ label, forms }))
  }
  const keep = (b: ConjBlock): boolean => b.rows.some(r => r.forms.length)

  const out: ConjSection[] = []
  for (const [mood, title, tenses] of FINITE) {
    const blocks = tenses.map(([t, tt]) => ({ title: tt, rows: persons(`${mood}.${t}`) })).filter(keep)
    if (blocks.length) out.push({ title, blocks })
  }
  const cond = { title: 'Presente', rows: persons('cond') }
  if (keep(cond)) out.push({ title: 'Condizionale', blocks: [cond] })
  const imp = { title: 'Imperativo', rows: persons('imp', ['2s', '3s', '1p', '2p', '3p']).filter(r => r.forms.length) }
  if (keep(imp)) out.push({ title: 'Imperativo', blocks: [imp] })

  const past = ['ptcp.past', 'ptcp.past.m.s', 'ptcp.past.f.s', 'ptcp.past.m.p', 'ptcp.past.f.p', 'ptcp.past.p']
    .flatMap(get).filter((f, i, a) => a.indexOf(f) === i)
  const nonFinite: ConjRow[] = [
    { label: 'infinito', forms: get('inf') },
    { label: 'gerundio', forms: get('ger') },
    { label: 'participio presente', forms: get('ptcp.pres') },
    { label: 'participio passato', forms: past },
  ].filter(r => r.forms.length)
  if (nonFinite.length) out.push({ title: 'Modi indefiniti', blocks: [{ title: '', rows: nonFinite }] })
  return out
}
