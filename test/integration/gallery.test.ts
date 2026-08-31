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
    { id: 'c1', name: 'Familie' },
    { id: 'c2', name: 'Arbeit' },
  ])
  repo.upsertMessages([
    { id: 'm1', chatId: 'c1', ts: 1_700_000_000, body: 'Foto', mediaId: 'a1' },
    { id: 'm2', chatId: 'c1', ts: 1_700_000_100, body: 'Video', mediaId: 'a2' },
    { id: 'm3', chatId: 'c1', ts: 1_700_000_200, body: 'Angebot', mediaId: 'a3' },
    { id: 'm4', chatId: 'c1', ts: 1_700_000_300, body: 'Sprachnachricht', mediaId: 'a4' },
    { id: 'm5', chatId: 'c1', ts: 1_700_000_400, body: 'Schau mal https://example.org/x' },
    { id: 'm6', chatId: 'c2', ts: 1_700_000_500, body: 'Fremdes Bild', mediaId: 'a5' },
  ])
  repo.upsertMedia([
    { id: 'a1', msgId: 'm1', chatId: 'c1', mime: 'image/jpeg', filename: 'foto.jpg' },
    { id: 'a2', msgId: 'm2', chatId: 'c1', mime: 'video/mp4', filename: 'clip.mp4' },
    { id: 'a3', msgId: 'm3', chatId: 'c1', mime: 'application/pdf', filename: 'angebot.pdf' },
    { id: 'a4', msgId: 'm4', chatId: 'c1', mime: 'audio/ogg', filename: 'ptt.ogg' },
    { id: 'a5', msgId: 'm6', chatId: 'c2', mime: 'image/png', filename: 'anderes.png' },
  ])
})

describe('gallery', () => {
  it('separates the media kinds', () => {
    expect(repo.gallery({ chatId: 'c1', kind: 'image', limit: 50 }).map((i) => i.mediaId)).toEqual([
      'a1',
    ])
    expect(repo.gallery({ chatId: 'c1', kind: 'video', limit: 50 }).map((i) => i.mediaId)).toEqual([
      'a2',
    ])
    expect(repo.gallery({ chatId: 'c1', kind: 'audio', limit: 50 }).map((i) => i.mediaId)).toEqual([
      'a4',
    ])
  })

  it('treats anything that is not image, video or audio as a document', () => {
    // Defined by exclusion rather than a list of mime types, which would go stale the first time
    // somebody sends a format nobody thought of.
    repo.upsertMessages([{ id: 'm7', chatId: 'c1', ts: 1_700_000_600, mediaId: 'a6' }])
    repo.upsertMedia([
      { id: 'a6', msgId: 'm7', chatId: 'c1', mime: 'application/vnd.oasis.opendocument.text' },
    ])
    const ids = repo.gallery({ chatId: 'c1', kind: 'document', limit: 50 }).map((i) => i.mediaId)
    expect(ids).toContain('a3')
    expect(ids).toContain('a6')
    expect(ids).not.toContain('a1')
  })

  it('finds links in message bodies, which are not media rows at all', () => {
    const links = repo.gallery({ chatId: 'c1', kind: 'link', limit: 50 })
    expect(links).toHaveLength(1)
    expect(links[0]?.text).toContain('https://example.org/x')
    expect(links[0]?.msgId).toBe('m5')
  })

  it('stays inside the chat it was asked about', () => {
    const images = repo.gallery({ chatId: 'c1', kind: 'image', limit: 50 })
    expect(images.every((i) => i.chatId === 'c1')).toBe(true)
  })

  it('spans every chat when no chat is given', () => {
    expect(repo.gallery({ kind: 'image', limit: 50 })).toHaveLength(2)
  })

  it('pages newest-first from a cursor', () => {
    const all = repo.gallery({ chatId: 'c1', kind: 'document', limit: 50 })
    repo.upsertMessages([{ id: 'm8', chatId: 'c1', ts: 1_600_000_000, mediaId: 'a7' }])
    repo.upsertMedia([{ id: 'a7', msgId: 'm8', chatId: 'c1', mime: 'application/pdf' }])

    const older = repo.gallery({
      chatId: 'c1',
      kind: 'document',
      limit: 50,
      beforeTs: all[0]?.ts,
    })
    expect(older.map((i) => i.mediaId)).toEqual(['a7'])
  })
})

describe('jumping to a date', () => {
  it('lands on the first message at or after the day', () => {
    const cursor = repo.firstMessageOnOrAfter('c1', 1_700_000_150)
    expect(cursor?.id).toBe('m3')
  })

  it('returns nothing for a date after everything, rather than the last message', () => {
    // Silently landing on the end would look like the jump worked and the chat simply stopped.
    expect(repo.firstMessageOnOrAfter('c1', 1_900_000_000)).toBeUndefined()
  })

  it('lists the months that actually have something in them', () => {
    const months = repo.monthsWithMessages('c1')
    expect(months).toHaveLength(1)
    expect(months[0]?.count).toBe(5)
    expect(months[0]?.month).toMatch(/^\d{4}-\d{2}$/)
  })
})
