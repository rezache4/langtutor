// Compact tag codes from the pipeline ("ind.pres.1s", "cond.3s", "ptcp.past", "ger", "inf", "f.pl").
export type TagGroup = 'Present' | 'Past' | 'Imperfect' | 'Future' | 'Conditional' | 'Subjunctive' | 'Imperative' | 'Non-finite' | 'Other'
export const GROUPS: TagGroup[] = ['Present', 'Past', 'Imperfect', 'Future', 'Conditional', 'Subjunctive', 'Imperative', 'Non-finite', 'Other']

const PERSON: Record<string, string> = {
  '1s': '1st person singular', '2s': '2nd person singular', '3s': '3rd person singular',
  '1p': '1st person plural', '2p': '2nd person plural', '3p': '3rd person plural',
}
const SHORT: Record<string, string> = { '1s': '1st sg', '2s': '2nd sg', '3s': '3rd sg', '1p': '1st pl', '2p': '2nd pl', '3p': '3rd pl' }
const TENSE: Record<string, string> = { pres: 'present', impf: 'imperfect', hist: 'past historic', fut: 'future' }
const GENDER: Record<string, string> = { m: 'masculine', f: 'feminine' }
const NUM: Record<string, string> = { s: 'singular', p: 'plural' }

export function labelTag(code: string): string | null {
  const p = code.trim().split('.')
  const [h, ...r] = p
  if (h === 'inf') return 'infinitive'
  if (h === 'ger') return 'gerund'
  if (h === 'ptcp') {
    const t = r[0] === 'pres' ? 'present participle' : 'past participle'
    const ex = r.slice(1).map(x => GENDER[x] ?? NUM[x]).filter(Boolean)
    return ex.length ? `${t} · ${ex.join(' ')}` : t
  }
  if (h === 'cond') return SHORT[r[0]] ? `conditional · ${SHORT[r[0]]}` : 'conditional'
  if (h === 'imp') return PERSON[r[0]] ? `imperative · ${SHORT[r[0]]}` : 'imperative'
  if (h === 'ind' || h === 'sub') {
    const t = TENSE[r[0]]
    if (!t) return null
    const per = PERSON[r[1]]
    if (h === 'sub') return per ? `${per} · ${t} subjunctive` : `${t} subjunctive`
    return per ? `${per} · ${t}` : t
  }
  const ex = p.map(x => GENDER[x] ?? NUM[x] ?? (x === 'dim' ? 'diminutive' : x === 'sup' ? 'superlative' : x === 'aug' ? 'augmentative' : '')).filter(Boolean)
  return ex.length ? ex.join(' ') : null
}

export function groupOf(code: string): TagGroup {
  const [h, a] = code.trim().split('.')
  if (h === 'inf' || h === 'ger' || h === 'ptcp') return 'Non-finite'
  if (h === 'cond') return 'Conditional'
  if (h === 'imp') return 'Imperative'
  if (h === 'sub') return 'Subjunctive'
  if (h === 'ind') return a === 'pres' ? 'Present' : a === 'impf' ? 'Imperfect' : a === 'fut' ? 'Future' : a === 'hist' ? 'Past' : 'Other'
  return 'Other'
}

export const codesOf = (tags: string | string[] | undefined): string[] =>
  (Array.isArray(tags) ? tags.join(' | ') : tags ?? '').split('|').map(s => s.trim()).filter(Boolean)

/** Plain labels for a stored tag string; unknown codes are dropped. */
export const labelsOf = (tags: string | string[] | undefined): string[] =>
  codesOf(tags).map(labelTag).filter((x): x is string => !!x)

/** Forms of a lemma grouped by tense/mood, for compact display. */
export function groupForms(forms: { form: string; tags: string }[]): [TagGroup, string[]][] {
  const g = new Map<TagGroup, Set<string>>()
  for (const f of forms) {
    const code = codesOf(f.tags).find(x => labelsOf(x).length)
    const grp = code ? groupOf(code) : 'Other'
    if (!g.has(grp)) g.set(grp, new Set())
    g.get(grp)!.add(f.form)
  }
  return GROUPS.filter(x => g.has(x)).map(x => [x, [...g.get(x)!]] as [TagGroup, string[]])
}

const TENSE_PLAIN: Record<string, string> = { pres: 'present', impf: 'imperfect', hist: 'past historic', fut: 'future' }

/** Short plain-English label for one tag code: "1st sg present", "plural", "past participle". */
export function shortLabel(code: string): string | null {
  const [h, ...r] = code.trim().split('.')
  if (!h) return null
  if (h === 'inf') return 'infinitive'
  if (h === 'ger') return 'gerund'
  if (h === 'ptcp') {
    const t = r[0] === 'pres' ? 'present participle' : 'past participle'
    const ex = r.slice(1).map(x => GENDER[x] ?? NUM[x]).filter(Boolean)
    return ex.length ? `${t}, ${ex.join(' ')}` : t
  }
  if (h === 'cond') return SHORT[r[0]] ? `${SHORT[r[0]]} conditional` : 'conditional'
  if (h === 'imp') return SHORT[r[0]] ? `${SHORT[r[0]]} imperative` : 'imperative'
  if (h === 'ind' || h === 'sub') {
    const t = TENSE_PLAIN[r[0]]
    if (!t) return null
    const per = SHORT[r[1]]
    return [per, t, h === 'sub' ? 'subjunctive' : ''].filter(Boolean).join(' ')
  }
  const ex = code.trim().split('.').map(x => GENDER[x] ?? NUM[x] ?? (x === 'dim' ? 'diminutive' : x === 'sup' ? 'superlative' : x === 'aug' ? 'augmentative' : '')).filter(Boolean)
  return ex.length ? ex.join(' ') : null
}

/** Plain labels (at most `max`) for a stored tag string; an empty tag set is the dictionary form. */
export function plainLabels(tags: string | undefined, max = 2): string[] {
  const out = [...new Set(codesOf(tags).map(shortLabel).filter((x): x is string => !!x))]
  return out.slice(0, max)
}
