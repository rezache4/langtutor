import { db, type Form, type Lemma, type UserEntry } from '../db/schema'
import { plainLabels } from './tags'
import { norm } from './userdata'

export interface Ranked { l: Lemma; tags: string }

export type Suggestion =
  | { kind: 'lemma'; form: string; l: Lemma; tags: string; label: string }
  | { kind: 'entry'; form: string; entry: UserEntry }

const ACCENTS: Record<string, string[]> = {
  a: ['à', 'á'], e: ['è', 'é'], i: ['ì', 'í', 'î'], o: ['ò', 'ó'], u: ['ù', 'ú'],
}

export const fold = (s: string) => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** Prefix variants with single-vowel Italian accents so e.g. 'perche' matches 'perché'. */
export function accentPrefixes(q: string): string[] {
  const f = norm(q), b = fold(f)
  if (!b) return []
  const out = new Set<string>([f, b])
  for (let i = 0; i < b.length; i++) {
    const vars = ACCENTS[b[i]]
    if (vars) for (const v of vars) out.add(b.slice(0, i) + v + b.slice(i + 1))
  }
  if (f !== b) {
    for (let i = f.length - 1; i >= 0; i--) {
      const vars = ACCENTS[f[i]]
      if (vars) { for (const v of vars) out.add(f.slice(0, i) + v + f.slice(i + 1)); break }
    }
  }
  return [...out]
}

/**
 * Lemmas a surface form maps to, most likely first: corpus frequency of the lemma, then headword
 * equal to the form, then number of examples and of known forms (the old heuristic). Only the form's
 * own mappings are used.
 */
export async function rankForm(form: string): Promise<Ranked[]> {
  const f = norm(form)
  if (!f) return []
  let hits = await db.formIndex.where('form').equals(f).toArray()
  if (!hits.length) {
    const vars = accentPrefixes(f).filter(p => fold(p) === fold(f))
    if (vars.length) hits = await db.formIndex.where('form').anyOf(vars).toArray()
  }
  const tags = new Map<number, string[]>()
  for (const h of hits) tags.set(h.lemmaId, [...(tags.get(h.lemmaId) ?? []), h.tags])
  const lemmas = (await db.lemmas.bulkGet([...tags.keys()])).filter((l): l is Lemma => !!l)
  const meta = await Promise.all(lemmas.map(async l => ({
    l, tags: tags.get(l.id)!.filter(Boolean).join(' | '),
    n: lemmas.length > 1 ? await db.examples.where('lemmaId').equals(l.id).count() : 0,
    nForms: lemmas.length > 1 ? await db.formIndex.where('lemmaId').equals(l.id).count() : 0,
  })))
  meta.sort((a, b) =>
    (b.l.freq ?? 0) - (a.l.freq ?? 0) ||
    Number(b.l.lemma === f) - Number(a.l.lemma === f) ||
    b.n - a.n || b.nForms - a.nForms || a.l.id - b.l.id)
  return meta.map(({ l, tags }) => ({ l, tags }))
}

/** True when the top two candidates are indistinguishable by frequency (both 0): ask the user. */
export const needsChooser = (r: Ranked[]) => r.length > 1 && (r[0].l.freq ?? 0) === 0 && (r[1].l.freq ?? 0) === 0

/** "1st sg present" / "plural" for a form under a lemma; empty tags are the dictionary form. */
export function formLabel(r: Ranked, form: string): string {
  const labels = plainLabels(r.tags)
  if (labels.length) return labels.join(' / ')
  return r.l.lemma === form ? 'dictionary form' : ''
}

export const wordUrl = (l: Lemma, form?: string) =>
  `/word/${encodeURIComponent(l.lemma)}?id=${l.id}${form ? `&form=${encodeURIComponent(form)}` : ''}`

/** Prefix autocomplete across formIndex.form and userEntries.text, grouped one row per lemma. */
export async function suggest(raw: string, limit = 10): Promise<Suggestion[]> {
  const f = norm(raw), b = fold(f)
  if (!b) return []
  const prefixes = accentPrefixes(f)
  const perPrefix = b.length < 2 ? 250 : 350
  const [exactHits, prefixBatches, lemmaPrefixHits, userHits] = await Promise.all([
    db.formIndex.where('form').anyOf(prefixes).toArray(),
    Promise.all(prefixes.map(p => db.formIndex.where('form').startsWith(p).limit(perPrefix).toArray())),
    b.length <= 2 ? db.lemmas.where('lemma').startsWithAnyOf(prefixes).limit(350).toArray() : Promise.resolve([] as Lemma[]),
    db.userEntries.filter(e => !e.deleted && fold(e.text).startsWith(b)).toArray(),
  ])

  const combined = new Map<string, { lemmaId: number; form: string; tags: string[] }>()
  const addHit = (h: Form) => {
    const key = `${h.lemmaId}\0${h.form}`
    const cur = combined.get(key)
    if (cur) { if (h.tags && !cur.tags.includes(h.tags)) cur.tags.push(h.tags) }
    else combined.set(key, { lemmaId: h.lemmaId, form: h.form, tags: h.tags ? [h.tags] : [] })
  }
  for (const h of exactHits) addHit(h)
  for (const batch of prefixBatches) for (const h of batch) addHit(h)
  for (const l of lemmaPrefixHits) addHit({ form: l.lemma, lemmaId: l.id, tags: '' })

  const lemmaIds = [...new Set([...combined.values()].map(v => v.lemmaId))]
  const lemmaRows = await db.lemmas.bulkGet(lemmaIds)
  const lemmaMap = new Map<number, Lemma>()
  for (const l of lemmaRows) if (l) lemmaMap.set(l.id, l)
  for (const l of lemmaPrefixHits) lemmaMap.set(l.id, l)

  const formRank = (form: string, l: Lemma) =>
    (form === f ? 16 : 0) +
    (fold(form) === b ? 8 : 0) +
    (form.startsWith(f) ? 4 : 0) +
    (form === l.lemma ? 2 : 0)

  const bestByLemma = new Map<number, { form: string; l: Lemma; tags: string }>()
  for (const { lemmaId, form, tags } of combined.values()) {
    const l = lemmaMap.get(lemmaId)
    if (!l) continue
    const tagStr = tags.filter(Boolean).join(' | ')
    const prev = bestByLemma.get(lemmaId)
    if (!prev) {
      bestByLemma.set(lemmaId, { form, l, tags: tagStr })
      continue
    }
    const sNew = formRank(form, l), sPrev = formRank(prev.form, l)
    if (sNew > sPrev || (sNew === sPrev && (form.length < prev.form.length || (form.length === prev.form.length && form < prev.form)))) {
      bestByLemma.set(lemmaId, { form, l, tags: tagStr })
    }
  }

  const out: Suggestion[] = []
  for (const { form, l, tags } of bestByLemma.values()) {
    out.push({ kind: 'lemma', form, l, tags, label: formLabel({ l, tags }, form) })
  }
  for (const entry of userHits) {
    out.push({ kind: 'entry', form: norm(entry.text), entry })
  }

  const isExact = (s: Suggestion) => Number(fold(s.form) === b)
  const isStrictExact = (s: Suggestion) => Number(s.form === f)
  const freqOf = (s: Suggestion) => s.kind === 'lemma' ? (s.l.freq ?? 0) : Number.MAX_SAFE_INTEGER

  out.sort((a, c) =>
    isExact(c) - isExact(a) ||
    freqOf(c) - freqOf(a) ||
    isStrictExact(c) - isStrictExact(a) ||
    Number(c.kind === 'lemma' && c.l.lemma === c.form) - Number(a.kind === 'lemma' && a.l.lemma === a.form) ||
    a.form.length - c.form.length ||
    a.form.localeCompare(c.form))

  return out.slice(0, limit)
}
