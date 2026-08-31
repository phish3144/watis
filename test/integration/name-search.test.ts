import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { ArchiveRepository } from '../../src/workers/archive/repository'

let db: Database.Database
let repo: ArchiveRepository

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)

  repo.upsertChats([
    { id: 'c1', name: 'Rechnungen', kind: 'group', lastMsgTs: 1_700_000_200 },
    { id: 'c2', name: 'Anna Schäfer', kind: 'dm', lastMsgTs: 1_700_000_400 },
    { id: 'c3', name: 'Küche Umbau', kind: 'group', lastMsgTs: 1_700_000_100 },
  ])
  repo.upsertContacts([
    { jid: 'anna@s', name: 'Anna Schäfer', pushname: 'Anna', phone: '4915100000' },
    { jid: 'bernd@s', name: 'Bernd Groß', phone: '4915111111' },
  ])
})

describe('finding chats and contacts by name', () => {
  it('finds a chat by part of its name', () => {
    const hits = repo.findChatsAndContacts('rechnung')
    expect(hits.filter((h) => h.kind === 'chat').map((h) => h.id)).toEqual(['c1'])
  })

  it('matches the folded form, so umlauts behave as they do in message search', () => {
    // Grüße finds Gruesse in the message index (ADR 0002); a name search that did not would be
    // the same application answering the same question two different ways.
    expect(repo.findChatsAndContacts('schaefer').some((h) => h.label.includes('Schäfer'))).toBe(
      true,
    )
    expect(repo.findChatsAndContacts('kueche').some((h) => h.label.includes('Küche'))).toBe(true)
    expect(repo.findChatsAndContacts('gross').some((h) => h.label.includes('Groß'))).toBe(true)
  })

  it('finds a contact by push name and by number', () => {
    expect(repo.findChatsAndContacts('4915111').map((h) => h.id)).toContain('bernd@s')
    expect(repo.findChatsAndContacts('anna').map((h) => h.id)).toContain('anna@s')
  })

  it('orders chats by recency, not alphabetically', () => {
    const chats = repo.findChatsAndContacts('e').filter((h) => h.kind === 'chat')
    const times = chats.map((c) => c.lastTs ?? 0)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })

  it('answers an empty query with nothing rather than everything', () => {
    expect(repo.findChatsAndContacts('   ')).toEqual([])
  })

  it('respects the limit on each kind', () => {
    const hits = repo.findChatsAndContacts('a', 1)
    expect(hits.filter((h) => h.kind === 'chat')).toHaveLength(1)
  })

  it('does not put names into the message index', () => {
    // A chat called "Rechnungen" must not rank against every message about an invoice; those are
    // different kinds of answer and merging them makes both worse.
    const docs = db.prepare(`SELECT count(*) AS n FROM search_docs`).get() as { n: number }
    expect(docs.n).toBe(0)
  })
})
