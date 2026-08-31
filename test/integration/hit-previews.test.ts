import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { ArchiveRepository } from '../../src/workers/archive/repository'

let db: Database.Database
let repo: ArchiveRepository

const addContent = (
  mediaId: string,
  source: string,
  text: string,
  lines: unknown[],
  confidence?: number,
): void => {
  db.prepare(
    `INSERT INTO content_text (media_id, source, text, detail_json, engine, confidence, created_ts)
     VALUES (?, ?, ?, ?, 'test', ?, 0)`,
  ).run(mediaId, source, text, JSON.stringify({ lines }), confidence ?? null)
}

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)

  repo.upsertChats([{ id: 'c1', name: 'Dachdecker' }])
  repo.upsertMessages([
    { id: 'm1', chatId: 'c1', ts: 1000, body: 'Grüße aus dem Büro' },
    { id: 'm2', chatId: 'c1', ts: 2000, mediaId: 'd1' },
  ])
  repo.upsertMedia([
    { id: 'd1', msgId: 'm2', chatId: 'c1', mime: 'image/png', filename: 'rechnung.png' },
  ])
  repo.attachBlob('d1', 'a'.repeat(64), 100)
})

describe('hitPreviews', () => {
  it('shows the original message text, not the folded index form', () => {
    // search_fts stores an umlaut-folded variant so Grüße and Gruesse find each other (ADR 0002).
    // Showing that back would look like the archive had mangled the message.
    const [preview] = repo.hitPreviews([{ msgId: 'm1', mediaId: null, source: 'body' }])
    expect(preview?.text).toBe('Grüße aus dem Büro')
  })

  it('returns the line the search hit, with where it was found', () => {
    addContent(
      'd1',
      'ocr',
      'Rechnung Nr 4711\nBetrag 320,00 EUR\nZahlbar bis 01.09.',
      [
        { text: 'Rechnung Nr 4711', box: [10, 10, 200, 30], confidence: 91 },
        { text: 'Betrag 320,00 EUR', box: [10, 40, 200, 60], confidence: 88 },
        { text: 'Zahlbar bis 01.09.', box: [10, 70, 200, 90], confidence: 72 },
      ],
      84,
    )

    const [preview] = repo.hitPreviews([{ msgId: 'm2', mediaId: 'd1', source: 'ocr' }], ['betrag'])
    expect(preview?.text).toBe('Betrag 320,00 EUR')
    expect(preview?.box).toEqual([10, 40, 200, 60])
    expect(preview?.confidence).toBe(88)
    expect(preview?.filename).toBe('rechnung.png')
  })

  it('carries the page for a PDF hit', () => {
    addContent('d1', 'pdf', 'Seite eins\nSeite zwei mit Angebot', [
      { text: 'Seite eins', page: 1 },
      { text: 'Seite zwei mit Angebot', page: 2 },
    ])
    const [preview] = repo.hitPreviews([{ msgId: 'm2', mediaId: 'd1', source: 'pdf' }], ['angebot'])
    expect(preview?.page).toBe(2)
  })

  it('carries the time offset for a transcript hit', () => {
    addContent('d1', 'transcript', 'ganz am Anfang\nspäter der Termin', [
      { text: 'ganz am Anfang', startSeconds: 0 },
      { text: 'später der Termin', startSeconds: 42.5 },
    ])
    const [preview] = repo.hitPreviews(
      [{ msgId: 'm2', mediaId: 'd1', source: 'transcript' }],
      ['termin'],
    )
    expect(preview?.startSeconds).toBe(42.5)
  })

  it('falls back to the first line when no line contains the term literally', () => {
    // The index matched the folded form, so the raw text may not contain the typed word at all.
    // The first line is still better than nothing, and its page is usually right.
    addContent('d1', 'ocr', 'Grüße', [{ text: 'Grüße', page: 1 }])
    const [preview] = repo.hitPreviews([{ msgId: 'm2', mediaId: 'd1', source: 'ocr' }], ['gruesse'])
    expect(preview?.text).toBe('Grüße')
    expect(preview?.page).toBe(1)
  })

  it('survives detail_json that is not what any engine writes', () => {
    db.prepare(
      `INSERT INTO content_text (media_id, source, text, detail_json, engine, created_ts)
       VALUES ('d1', 'pdf', 'nur Text', '{not json', 'test', 0)`,
    ).run()
    const [preview] = repo.hitPreviews([{ msgId: 'm2', mediaId: 'd1', source: 'pdf' }], ['text'])
    expect(preview?.text).toBe('nur Text')
    expect(preview?.page).toBeUndefined()
  })

  it('shortens a long extraction instead of returning the whole document', () => {
    addContent('d1', 'pdf', 'x'.repeat(5000), [])
    const [preview] = repo.hitPreviews([{ msgId: 'm2', mediaId: 'd1', source: 'pdf' }])
    expect(preview?.text.length).toBeLessThan(300)
    expect(preview?.text.endsWith('…')).toBe(true)
  })

  it('answers for a hit whose content was never extracted', () => {
    const [preview] = repo.hitPreviews([{ msgId: 'm2', mediaId: 'd1', source: 'ocr' }])
    expect(preview?.text).toBe('')
  })
})
