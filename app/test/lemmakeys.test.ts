import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { upgradeExport } from '../src/lib/legacy'

describe('v3 -> v4 migration to stable lemma keys', () => {
  it('rekeys cards, review logs, user glosses and user examples; tombstones unresolvable rows', async () => {
    // A v3 database as an existing install has it.
    const old = new Dexie('langtutor')
    old.version(3).stores({
      lemmas: 'id, lemma', formIndex: '++id, form, lemmaId', examples: 'id, lemmaId',
      cards: 'id, lemmaId, entryId, due, updatedAt', reviewLog: 'id, cardId, reviewedAt, synced, updatedAt',
      settings: 'key, updatedAt', userEntries: 'id, text, updatedAt',
      userExamples: 'id, lemmaId, phraseId, src, updatedAt', userGlosses: 'id, lemmaId, src, updatedAt', entryPool: 'entryId',
    })
    await old.table('lemmas').bulkPut([
      { id: 1, lemma: 'andare', pos: 'verb', glosses: ['to go'] },
      { id: 2, lemma: 'casa', pos: 'noun', glosses: ['house'] },
    ])
    await old.table('cards').bulkPut([
      { id: 'l1', lemmaId: 1, due: 5, stability: 3, reps: 4, updatedAt: 1 },
      { id: 'l2', lemmaId: 2, due: 6, stability: 1, reps: 1, updatedAt: 1 },
      { id: 'l99', lemmaId: 99, due: 7, stability: 1, reps: 1, updatedAt: 1 }, // lemma no longer in the dictionary
      { id: 'eabc', entryId: 'abc', due: 8, stability: 1, reps: 1, updatedAt: 1 },
    ])
    await old.table('reviewLog').bulkPut([
      { id: 'r1', cardId: 'l1', rating: 3, reviewedAt: 10, updatedAt: 10 },
      { id: 'r2', cardId: 'eabc', rating: 3, reviewedAt: 11, updatedAt: 11 },
    ])
    await old.table('userGlosses').put({ id: 'g1', lemmaId: 2, text: 'home', updatedAt: 1 })
    await old.table('userGlosses').put({ id: 'g2', lemmaId: 99, text: 'gone', updatedAt: 1 })
    await old.table('userExamples').bulkPut([
      { id: 'x1', lemmaId: 1, phraseId: null, it: 'Vado.', updatedAt: 1 },
      { id: 'x2', lemmaId: null, phraseId: 'abc', it: 'Ciao.', updatedAt: 1 },
    ])
    old.close()

    const { db, lemmaCardId } = await import('../src/db/schema')
    await db.open()

    expect((await db.lemmas.get(1))?.key).toBe('andare|verb')
    expect((await db.lemmas.where('key').equals('casa|noun').first())?.id).toBe(2)

    const ids = (await db.cards.toArray()).map(c => c.id).sort()
    expect(ids).toEqual(['eabc', 'l99', lemmaCardId('andare|verb'), lemmaCardId('casa|noun')].sort())
    const andare = (await db.cards.get('l:andare|verb'))!
    expect(andare).toMatchObject({ lemmaKey: 'andare|verb', due: 5, stability: 3, reps: 4 })
    expect('lemmaId' in andare).toBe(false)
    expect((await db.cards.get('l99'))?.deleted).toBe(1)
    expect((await db.cards.get('eabc'))?.entryId).toBe('abc')

    expect((await db.reviewLog.get('r1'))?.cardId).toBe('l:andare|verb')
    expect((await db.reviewLog.get('r2'))?.cardId).toBe('eabc')

    expect(await db.userGlosses.get('g1')).toMatchObject({ lemmaKey: 'casa|noun' })
    expect((await db.userGlosses.get('g2'))?.deleted).toBe(1)
    expect(await db.userExamples.get('x1')).toMatchObject({ lemmaKey: 'andare|verb' })
    expect(await db.userExamples.get('x2')).toMatchObject({ lemmaKey: null, phraseId: 'abc' })
    expect((await db.userGlosses.where('lemmaKey').equals('casa|noun').toArray()).length).toBe(1)
  })

  it('card ids do not depend on the numeric lemma id', async () => {
    const { lemmaCardId, lemmaKeyOf } = await import('../src/db/schema')
    expect(lemmaCardId(lemmaKeyOf('andare', 'verb'))).toBe('l:andare|verb')
  })
})

describe('upgradeExport (pre-v4 backup files)', () => {
  const keys: Record<number, string> = { 1: 'andare|verb', 2: 'casa|noun' }
  const lookup = async (id: number) => keys[id]

  it('maps numeric / l<id> cards, logs and user rows to keys, and drops unresolvable ones', async () => {
    const up = await upgradeExport({
      cards: [{ id: 1 }, { id: 'l2', lemmaId: 2 }, { id: 'l9', lemmaId: 9 }, { id: 'eabc', entryId: 'abc' }],
      reviewLog: [{ id: 'r1', cardId: 1, reviewedAt: 5 }, { id: 'r2', cardId: 'l9' }, { id: 'r3', cardId: 'eabc' }],
      userGlosses: [{ id: 'g', lemmaId: 2, text: 'home' }, { id: 'h', lemmaId: 9, text: 'x' }],
      userExamples: [{ id: 'x', lemmaId: null, phraseId: 'abc' }],
    }, lookup, 100)
    expect(up.cards.map(c => c.id)).toEqual(['l:andare|verb', 'l:casa|noun', 'eabc'])
    expect(up.cards[0]).toMatchObject({ lemmaKey: 'andare|verb', updatedAt: 100 })
    expect(up.reviewLog.map(l => l.cardId)).toEqual(['l:andare|verb', 'eabc'])
    expect(up.userGlosses).toEqual([{ id: 'g', lemmaKey: 'casa|noun', text: 'home' }])
    expect(up.userExamples).toEqual([{ id: 'x', lemmaKey: null, phraseId: 'abc' }])
    expect(up.dropped).toBe(3) // card l9, its log, and gloss h
  })

  it('leaves current-format exports untouched', async () => {
    const up = await upgradeExport({
      cards: [{ id: 'l:casa|noun', lemmaKey: 'casa|noun', updatedAt: 3 }],
      reviewLog: [{ id: 'r', cardId: 'l:casa|noun', updatedAt: 4 }],
      userGlosses: [{ id: 'g', lemmaKey: 'casa|noun' }],
    }, lookup)
    expect(up.cards).toEqual([{ id: 'l:casa|noun', lemmaKey: 'casa|noun', updatedAt: 3 }])
    expect(up.reviewLog[0].cardId).toBe('l:casa|noun')
    expect(up.userGlosses).toEqual([{ id: 'g', lemmaKey: 'casa|noun' }])
    expect(up.dropped).toBe(0)
  })
})

describe('repairLegacyRows (pre-v4 rows pulled from the server)', () => {
  it('converts them, tombstones the old rows, ignores unresolvable ones and is idempotent', async () => {
    const { db } = await import('../src/db/schema')
    const { repairLegacyRows } = await import('../src/lib/legacy')
    const { isLive } = await import('../src/lib/cards')
    await db.lemmas.bulkPut([{ id: 10, key: 'bere|verb', lemma: 'bere', pos: 'verb', glosses: ['to drink'] }])
    await db.cards.bulkPut([
      { id: 'l10', lemmaId: 10, due: 1, stability: 2, reps: 3, updatedAt: 5 },
      { id: 'l777', lemmaId: 777, due: 1, stability: 2, reps: 3, updatedAt: 5 },
    ] as never[])
    await db.reviewLog.put({ id: 'rl', cardId: 'l10', rating: 3, reviewedAt: 1, updatedAt: 1 } as never)
    await db.userGlosses.put({ id: 'gl', lemmaId: 10, text: 'drink', updatedAt: 1 } as never)

    expect(isLive(await db.cards.get('l10'))).toBe(false) // malformed rows never count as cards
    expect(await repairLegacyRows()).toBe(3)

    const moved = (await db.cards.get('l:bere|verb'))!
    expect(moved).toMatchObject({ lemmaKey: 'bere|verb', reps: 3, stability: 2 })
    expect('lemmaId' in moved).toBe(false)
    expect(isLive(moved)).toBe(true)
    expect((await db.cards.get('l10'))?.deleted).toBe(1)
    expect((await db.cards.get('l777'))?.deleted).toBeUndefined() // lemma unknown: left alone (and not live)
    expect((await db.reviewLog.get('rl'))?.cardId).toBe('l:bere|verb')
    expect(await db.userGlosses.get('gl')).toMatchObject({ lemmaKey: 'bere|verb' })
    expect(await repairLegacyRows()).toBe(0)
  })
})
