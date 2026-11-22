// Compact tag codes from the pipeline ("ind.pres.1s", "cond.3s", "ptcp.past.m.p", "ger", "inf", "f.p") shown with the
// Italian grammar terms a learner meets in textbooks, and the pronouns instead of "1st/2nd/3rd person" labels.

export type TagGroup = 'Presente' | 'Passato remoto' | 'Imperfetto' | 'Futuro' | 'Condizionale' | 'Congiuntivo' | 'Imperativo' | 'Modi indefiniti' | 'Forme'
export const GROUPS: TagGroup[] = ['Presente', 'Passato remoto', 'Imperfetto', 'Futuro', 'Condizionale', 'Congiuntivo', 'Imperativo', 'Modi indefiniti', 'Forme']

/** Persons as the pronoun a beginner knows ("voi", not "2nd person plural"). */
export const PRONOUN: Record<string, string> = { '1s': 'io', '2s': 'tu', '3s': 'lui/lei', '1p': 'noi', '2p': 'voi', '3p': 'loro' }
export const PERSONS = ['1s', '2s', '3s', '1p', '2p', '3p'] as const
const TENSE: Record<string, string> = { pres: 'presente', impf: 'imperfetto', hist: 'passato remoto', fut: 'futuro' }
const GENDER: Record<string, string> = { m: 'maschile', f: 'femminile' }
const NUM: Record<string, string> = { s: 'singolare', p: 'plurale' }
const EXTRA: Record<string, string> = { dim: 'diminutivo', sup: 'superlativo', aug: 'accrescitivo' }

const POS: Record<string, string> = {
  noun: 'sostantivo', adj: 'aggettivo', verb: 'verbo', adv: 'avverbio', intj: 'interiezione', num: 'numerale', pron: 'pronome',
  conj: 'congiunzione', prep: 'preposizione', det: 'determinante', article: 'articolo', contraction: 'preposizione articolata',
  particle: 'particella', word: 'parola', phrase: 'frase',
}
/** Italian name of a part of speech (unknown values are shown as they are). */
export const posLabel = (pos: string): string => POS[pos] ?? pos

const person = (p: string | undefined) => (p && PRONOUN[p] ? ` (${PRONOUN[p]})` : '')

/** "gender number extras" for noun/adjective/participle codes: ["m","p"] -> "maschile plurale". */
function nominal(parts: string[]): string | null {
  const g = ['m', 'f'].filter(x => parts.includes(x)).map(x => GENDER[x]).join(' e ')
  const n = parts.filter(x => NUM[x]).map(x => NUM[x]).join(' ')
  const e = parts.filter(x => EXTRA[x]).map(x => EXTRA[x]).join(' ')
  return [g, n, e].filter(Boolean).join(' ') || null
}

/** Italian label of one tag code, e.g. "congiuntivo imperfetto (voi)"; null for codes with nothing to say. */
export function labelTag(code: string): string | null {
  const [h, ...r] = code.trim().split('.')
  if (!h) return null
  if (h === 'inf') return 'infinito'
  if (h === 'ger') return 'gerundio'
  if (h === 'ptcp') {
    const t = r[0] === 'pres' ? 'participio presente' : 'participio passato'
    const ex = nominal(r.slice(1))
    return ex ? `${t} · ${ex}` : t
  }
  if (h === 'cond') return `condizionale presente${person(r[0])}`
  if (h === 'imp') return `imperativo${person(r[0])}`
  if (h === 'ind' || h === 'sub') {
    const t = TENSE[r[0]]
    const per = person(t ? r[1] : r[0])
    if (h === 'sub') return `congiuntivo${t ? ' ' + t : ''}${per}`
    return t ? `${t}${per}` : null
  }
  return nominal(code.trim().split('.'))
}

export function groupOf(code: string): TagGroup {
  const [h, a] = code.trim().split('.')
  if (h === 'inf' || h === 'ger' || h === 'ptcp') return 'Modi indefiniti'
  if (h === 'cond') return 'Condizionale'
  if (h === 'imp') return 'Imperativo'
  if (h === 'sub') return 'Congiuntivo'
  if (h === 'ind') return a === 'pres' ? 'Presente' : a === 'impf' ? 'Imperfetto' : a === 'fut' ? 'Futuro' : a === 'hist' ? 'Passato remoto' : 'Forme'
  return 'Forme'
}

export const codesOf = (tags: string | string[] | undefined): string[] =>
  (Array.isArray(tags) ? tags.join(' | ') : tags ?? '').split('|').map(s => s.trim()).filter(Boolean)

/** Labels for a stored tag string; unknown codes are dropped. */
export const labelsOf = (tags: string | string[] | undefined): string[] =>
  codesOf(tags).map(labelTag).filter((x): x is string => !!x)

/** Forms of a lemma grouped by tense/mood, for compact display. */
export function groupForms(forms: { form: string; tags: string }[]): [TagGroup, string[]][] {
  const g = new Map<TagGroup, Set<string>>()
  for (const f of forms) {
    const code = codesOf(f.tags).find(x => labelTag(x))
    const grp = code ? groupOf(code) : 'Forme'
    if (!g.has(grp)) g.set(grp, new Set())
    g.get(grp)!.add(f.form)
  }
  return GROUPS.filter(x => g.has(x)).map(x => [x, [...g.get(x)!]] as [TagGroup, string[]])
}

export const shortLabel = labelTag

/** Labels (at most `max`) for a stored tag string; an empty tag set is the dictionary form. */
export function plainLabels(tags: string | undefined, max = 2): string[] {
  return [...new Set(codesOf(tags).map(labelTag).filter((x): x is string => !!x))].slice(0, max)
}
