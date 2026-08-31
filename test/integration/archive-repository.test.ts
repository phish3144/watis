import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { ArchiveRepository } from '../../src/workers/archive/repository'
import { parseQuery } from '@shared/search/query'

let db: Database.Database
let repo: ArchiveRepository

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)
})

const seed = (): void => {
  repo.upsertChats([
    { id: 'c1', name: 'Familie', kind: 'group' },
    { id: 'c2', name: 'Anna', kind: 'dm' },
  ])
  repo.upsertContacts([
    { jid: 'anna@s', name: 'Anna Beispiel', pushname: 'Anna' },
    { jid: 'bernd@s', name: 'Bernd Beispiel' },
  ])
  repo.upsertMessages([
    { id: 'm1', chatId: 'c1', senderJid: 'anna@s', ts: 1000, body: 'Treffen in München' },
    { id: 'm2', chatId: 'c1', senderJid: 'bernd@s', ts: 2000, body: 'Die Rechnung kommt' },
    { id: 'm3', chatId: 'c2', senderJid: 'anna@s', ts: 3000, body: 'Grüße aus der Straße' },
  ])
}

describe('batch writes', () => {
  it('writes a batch in one transaction and reports the count', () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: `m${String(i)}`,
      chatId: 'c1',
      ts: i,
      body: `Nachricht ${String(i)}`,
    }))
    repo.upsertChats([{ id: 'c1', name: 'Test' }])
    expect(repo.upsertMessages(rows)).toBe(500)
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 500 })
  })

  it('is a no-op for an empty batch', () => {
    expect(repo.upsertMessages([])).toBe(0)
  })

  it('updates rather than duplicates on re-import', () => {
    repo.upsertChats([{ id: 'c1', name: 'Familie' }])
    repo.upsertMessages([{ id: 'm1', chatId: 'c1', ts: 1, body: 'alt' }])
    repo.upsertMessages([{ id: 'm1', chatId: 'c1', ts: 1, body: 'neu' }])

    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 1 })
    expect(repo.search(parseQuery('alt'))).toEqual([])
    expect(repo.search(parseQuery('neu')).map((h) => h.msgId)).toEqual(['m1'])
  })

  it('rolls the whole batch back when one row is invalid', () => {
    repo.upsertChats([{ id: 'c1', name: 'Familie' }])
    expect(() =>
      repo.upsertMessages([
        { id: 'ok', chatId: 'c1', ts: 1, body: 'gut' },
        // ts is NOT NULL; a partial batch would leave the import unable to resume cleanly.
        { id: 'bad', chatId: 'c1', ts: null as unknown as number, body: 'schlecht' },
      ]),
    ).toThrow()
    expect(db.prepare('SELECT count(*) AS n FROM messages').get()).toEqual({ n: 0 })
  })
})

describe('keyset pagination', () => {
  beforeEach(() => {
    repo.upsertChats([{ id: 'c1', name: 'Familie' }])
    repo.upsertMessages(
      Array.from({ length: 10 }, (_, i) => ({
        id: `m${String(i).padStart(2, '0')}`,
        chatId: 'c1',
        ts: i * 100,
        body: `Nachricht ${String(i)}`,
      })),
    )
  })

  it('returns the newest page first', () => {
    expect(repo.messagesPage({ chatId: 'c1', limit: 3 }).map((m) => m.id)).toEqual([
      'm09',
      'm08',
      'm07',
    ])
  })

  it('walks backwards without gaps or repeats', () => {
    const first = repo.messagesPage({ chatId: 'c1', limit: 4 })
    const last = first.at(-1)
    expect(last).toBeDefined()
    const second = repo.messagesPage({
      chatId: 'c1',
      limit: 4,
      before: { ts: last?.ts ?? 0, id: last?.id ?? '' },
    })
    expect(second.map((m) => m.id)).toEqual(['m05', 'm04', 'm03', 'm02'])
  })

  it('walks forwards and still returns newest-first', () => {
    const page = repo.messagesPage({ chatId: 'c1', limit: 3, after: { ts: 200, id: 'm02' } })
    expect(page.map((m) => m.id)).toEqual(['m05', 'm04', 'm03'])
  })

  it('separates messages that share a timestamp by id', () => {
    // Without the id in the keyset, a page boundary inside a same-second burst would loop.
    repo.upsertMessages([
      { id: 'x1', chatId: 'c1', ts: 5000, body: 'a' },
      { id: 'x2', chatId: 'c1', ts: 5000, body: 'b' },
      { id: 'x3', chatId: 'c1', ts: 5000, body: 'c' },
    ])
    const first = repo.messagesPage({ chatId: 'c1', limit: 2 })
    expect(first.map((m) => m.id)).toEqual(['x3', 'x2'])
    const next = repo.messagesPage({ chatId: 'c1', limit: 2, before: { ts: 5000, id: 'x2' } })
    expect(next.map((m) => m.id)).toEqual(['x1', 'm09'])
  })

  it('returns an empty page past the end', () => {
    expect(repo.messagesPage({ chatId: 'c1', limit: 5, before: { ts: 0, id: 'm00' } })).toEqual([])
  })
})

describe('search', () => {
  beforeEach(seed)

  it('finds a term in either German spelling', () => {
    expect(repo.search(parseQuery('Muenchen')).map((h) => h.msgId)).toEqual(['m1'])
    expect(repo.search(parseQuery('strasse')).map((h) => h.msgId)).toEqual(['m3'])
  })

  it('filters by chat name', () => {
    expect(
      repo
        .search(parseQuery('in:Familie'))
        .map((h) => h.msgId)
        .sort(),
    ).toEqual(['m1', 'm2'])
  })

  it('filters by sender name and pushname', () => {
    expect(
      repo
        .search(parseQuery('from:"Anna Beispiel"'))
        .map((h) => h.msgId)
        .sort(),
    ).toEqual(['m1', 'm3'])
    expect(
      repo
        .search(parseQuery('from:Anna'))
        .map((h) => h.msgId)
        .sort(),
    ).toEqual(['m1', 'm3'])
  })

  it('filters by date range', () => {
    const hits = repo.search({ ...parseQuery(''), after: 1500, before: 2500 })
    expect(hits.map((h) => h.msgId)).toEqual(['m2'])
  })

  it('runs a filter-only query without an FTS match', () => {
    // FTS5 rejects an empty MATCH, so this path must skip the join entirely.
    expect(repo.search(parseQuery('in:Anna')).map((h) => h.msgId)).toEqual(['m3'])
  })

  it('filters by source', () => {
    repo.upsertMedia([{ id: 'me1', msgId: 'm1', chatId: 'c1', mime: 'image/jpeg' }])
    db.prepare(
      "INSERT INTO content_text (msg_id, media_id, source, text) VALUES ('m1','me1','ocr','Rechnung im Bild')",
    ).run()

    expect(repo.search(parseQuery('Rechnung source:ocr')).map((h) => h.source)).toEqual(['ocr'])
    expect(repo.search(parseQuery('Rechnung source:body')).map((h) => h.msgId)).toEqual(['m2'])
  })

  it('filters by attachment kind', () => {
    repo.upsertMedia([
      { id: 'me1', msgId: 'm1', chatId: 'c1', mime: 'image/jpeg' },
      { id: 'me2', msgId: 'm2', chatId: 'c1', mime: 'application/pdf' },
    ])
    expect(repo.search(parseQuery('has:image')).map((h) => h.msgId)).toContain('m1')
    expect(repo.search(parseQuery('has:image')).map((h) => h.msgId)).not.toContain('m2')
  })

  it('combines several terms with AND', () => {
    expect(repo.search(parseQuery('Treffen München')).map((h) => h.msgId)).toEqual(['m1'])
    expect(repo.search(parseQuery('Treffen Rechnung'))).toEqual([])
  })

  it('honours the limit', () => {
    expect(repo.search(parseQuery('in:Familie'), 1)).toHaveLength(1)
  })
})

describe('context around a hit', () => {
  it('returns the neighbours newest-first with the hit in the middle', () => {
    repo.upsertChats([{ id: 'c1', name: 'Familie' }])
    repo.upsertMessages(
      Array.from({ length: 9 }, (_, i) => ({
        id: `m${String(i)}`,
        chatId: 'c1',
        ts: i * 10,
        body: `n${String(i)}`,
      })),
    )
    expect(repo.contextAround('m4', 2).map((m) => m.id)).toEqual(['m6', 'm5', 'm4', 'm3', 'm2'])
  })

  it('returns nothing for an unknown message', () => {
    expect(repo.contextAround('nope')).toEqual([])
  })
})
