import { db, type Lemma } from '../db/schema'
import { plainLabels } from './tags'

export interface Ranked { l: Lemma; tags: string }

/**
 * Lemmas a surface form maps to, most likely first: corpus frequency of the lemma, then headword
 * equal to the form, then number of examples and of known forms (the old heuristic). Only the form's
 * own mappings are used.
 */
export async function rankForm(form: string): Promise<Ranked[]> {
  const f = form.trim().toLowerCase()
  if (!f) return []
  const hits = await db.formIndex.where('form').equals(f).toArray()
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
