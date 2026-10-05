import { beforeEach, describe, expect, it } from 'vitest'
import { parseQuery } from '@shared/search/query'
import { openArchiveMemory } from '../helpers/sql'
import type { SqlDatabase } from '../../src/workers/archive/sql'
import { ArchiveRepository } from '../../src/workers/archive/repository'

let db: SqlDatabase
let repo: ArchiveRepository

beforeEach(() => {
  db = openArchiveMemory()
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

describe('sender names for a message list', () => {
  it('answers with the name, falling back to the push name, and leaves unknown senders out', () => {
    repo.upsertContacts([
      { jid: 'a@s', name: 'Anna Beispiel', pushname: 'Anna' },
      { jid: 'b@s', name: '', pushname: 'Bernd' },
      { jid: 'c@s', name: null, pushname: null },
    ])
    expect(repo.senderNames(['a@s', 'b@s', 'c@s', 'unknown@s', 'a@s'])).toEqual({
      'a@s': 'Anna Beispiel',
      'b@s': 'Bernd',
    })
  })

  it('answers an empty page with an empty map rather than an invalid IN ()', () => {
    expect(repo.senderNames([])).toEqual({})
  })
})

describe('messages by id, for a result list', () => {
  it('returns the messages that exist and skips the ones that do not', () => {
    repo.upsertChats([{ id: 'c1', name: 'Familie', kind: 'group' }])
    repo.upsertMessages([
      { id: 'm1', chatId: 'c1', senderJid: 'a@s', ts: 1, body: 'eins' },
      { id: 'm2', chatId: 'c1', senderJid: 'b@s', ts: 2, body: 'zwei', fromMe: true },
    ])
    const found = repo.messagesByIds(['m2', 'missing', 'm1', 'm2'])
    expect(found.map((m) => m.id).sort()).toEqual(['m1', 'm2'])
    expect(found.find((m) => m.id === 'm2')).toMatchObject({ body: 'zwei', fromMe: true })
    expect(repo.messagesByIds([])).toEqual([])
  })
})

describe('a transcript made on demand', () => {
  it('is stored, searchable as a transcript, and closes the waiting queue job', () => {
    repo.upsertChats([{ id: 'c1', name: 'Familie', kind: 'group' }])
    repo.upsertMessages([
      { id: 'v1', chatId: 'c1', senderJid: 'a@s', ts: 100, kind: 'ptt', mediaId: 'a1' },
    ])
    repo.upsertMedia([{ id: 'a1', msgId: 'v1', chatId: 'c1', mime: 'audio/ogg; codecs=opus' }])
    db.prepare(
      `INSERT INTO index_jobs (media_id, kind, priority, attempts, status, last_error, updated_ts)
       VALUES ('a1', 'transcript', 10, 0, 'skipped', 'no engine for transcript', 0)`,
    ).run()

    repo.storeExtraction('a1', {
      source: 'transcript',
      text: 'Die Küche kommt am Dienstag',
      lines: [{ text: 'Die Küche kommt am Dienstag', startSeconds: 0, endSeconds: 2.5 }],
      engine: 'whisper.cpp',
      engineVersion: 'small-q5_1',
      lang: 'de',
    })

    const hits = repo.search(parseQuery('Kueche source:transcript'))
    expect(hits.map((hit) => hit.mediaId)).toEqual(['a1'])
    expect(repo.transcript('a1')?.lines[0]).toMatchObject({ startSeconds: 0 })
    const job = db.prepare(`SELECT status FROM index_jobs WHERE media_id = 'a1'`).get() as {
      status: string
    }
    expect(job.status).toBe('done')
  })
})
