import { describe, expect, it } from 'vitest'
import { conjugation } from '../src/lib/conjugation'
import { groupForms, labelsOf, labelTag, plainLabels, posLabel } from '../src/lib/tags'

describe('Italian grammar labels', () => {
  it('names moods and tenses in Italian with pronouns instead of persons', () => {
    expect(labelTag('sub.impf.2p')).toBe('congiuntivo imperfetto (voi)')
    expect(labelTag('ind.pres.1s')).toBe('presente (io)')
    expect(labelTag('ind.hist.3s')).toBe('passato remoto (lui/lei)')
    expect(labelTag('cond.2p')).toBe('condizionale presente (voi)')
    expect(labelTag('imp.1p')).toBe('imperativo (noi)')
    expect(labelTag('inf')).toBe('infinito')
    expect(labelTag('ger')).toBe('gerundio')
    expect(labelTag('ptcp.past.f.p')).toBe('participio passato · femminile plurale')
    expect(labelTag('ptcp.pres')).toBe('participio presente')
  })
  it('labels nouns and adjectives', () => {
    expect(labelTag('m.p')).toBe('maschile plurale')
    expect(labelTag('f.s')).toBe('femminile singolare')
    expect(labelTag('p')).toBe('plurale')
    expect(labelTag('f.m.p')).toBe('maschile e femminile plurale')
    expect(labelTag('m.dim')).toBe('maschile diminutivo')
    expect(labelTag('')).toBeNull()
  })
  it('handles stored multi-code strings and unknown codes', () => {
    expect(labelsOf('ind.pres.2p | imp.2p')).toEqual(['presente (voi)', 'imperativo (voi)'])
    expect(plainLabels('ind.pres.2p | imp.2p', 1)).toEqual(['presente (voi)'])
    expect(plainLabels('')).toEqual([])
    expect(labelTag('ind')).toBeNull()
  })
  it('groups forms with Italian group names', () => {
    expect(groupForms([{ form: 'vado', tags: 'ind.pres.1s' }, { form: 'andasse', tags: 'sub.impf.3s' }, { form: 'andare', tags: 'inf' }]).map(g => g[0]))
      .toEqual(['Presente', 'Congiuntivo', 'Modi indefiniti'])
  })
  it('translates parts of speech', () => {
    expect(posLabel('verb')).toBe('verbo')
    expect(posLabel('adj')).toBe('aggettivo')
    expect(posLabel('mystery')).toBe('mystery')
  })
})

describe('conjugation table', () => {
  const f = (form: string, tags: string) => ({ form, tags })
  const andare = [
    f('vado', 'ind.pres.1s'), f('vai', 'ind.pres.2s | imp.2s'), f('va', 'ind.pres.3s | imp.2s'), f('andiamo', 'ind.pres.1p | sub.pres.1p | imp.1p'),
    f('andate', 'ind.pres.2p | imp.2p'), f('vanno', 'ind.pres.3p'), f('andavo', 'ind.impf.1s'), f('andaste', 'ind.hist.2p | sub.impf.2p'),
    f('andrebbe', 'cond.3s'), f('andare', 'inf'), f('andando', 'ger'), f('andante', 'ptcp.pres'), f('andato', 'ptcp.past'), f('andata', 'ptcp.past.f.s'),
  ]
  it('builds sections per mood with a row per pronoun and shares forms between slots', () => {
    const c = conjugation(andare)
    expect(c.map(s => s.title)).toEqual(['Indicativo', 'Congiuntivo', 'Condizionale', 'Imperativo', 'Modi indefiniti'])
    const ind = c[0].blocks
    expect(ind.map(b => b.title)).toEqual(['Presente', 'Imperfetto', 'Passato remoto'])
    expect(ind[0].rows.map(r => `${r.label}:${r.forms.join('/')}`)).toEqual(['io:vado', 'tu:vai', 'lui/lei:va', 'noi:andiamo', 'voi:andate', 'loro:vanno'])
    expect(c[1].blocks.map(b => b.title)).toEqual(['Presente', 'Imperfetto'])
    expect(c[1].blocks[0].rows[3].forms).toEqual(['andiamo'])
    expect(c[1].blocks[1].rows[4].forms).toEqual(['andaste'])
    expect(c[3].blocks[0].rows.map(r => `${r.label}:${r.forms.join('/')}`)).toEqual(['tu:vai/va', 'noi:andiamo', 'voi:andate'])
    expect(c[4].blocks[0].rows.map(r => `${r.label}:${r.forms.join('/')}`))
      .toEqual(['infinito:andare', 'gerundio:andando', 'participio presente:andante', 'participio passato:andato/andata'])
  })
  it('fills the missing 3rd singular of the present subjunctive from the 1st/2nd when those agree', () => {
    const c = conjugation([f('vada', 'sub.pres.1s | sub.pres.2s'), f('andiamo', 'sub.pres.1p')])
    expect(c[0].blocks[0].rows.map(r => `${r.label}:${r.forms.join('/')}`)).toEqual(['io:vada', 'tu:vada', 'lui/lei:vada', 'noi:andiamo', 'voi:', 'loro:'])
    const d = conjugation([f('amino', 'sub.pres.1s'), f('amini', 'sub.pres.2s')])
    expect(d[0].blocks[0].rows[2].forms).toEqual([])
  })
  it('returns nothing for words without verb forms', () => {
    expect(conjugation([f('casa', ''), f('case', 'p')])).toEqual([])
  })
})
