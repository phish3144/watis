import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { LATEST_VERSION } from '../../src/workers/archive/schema'
import { migrate, registerFunctions } from '../../src/workers/archive/db'

/** An in-memory archive at the current schema version. */
function fresh(): Database.Database {
  const db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  return db
}

const insertChat = (db: Database.Database, id = 'c1') =>
  db
    .prepare("INSERT INTO chats (id, jid, name, kind) VALUES (?, ?, ?, 'dm')")
    .run(id, `${id}@s`, id)

const insertMessage = (db: Database.Database, id: string, body: string | null, chat = 'c1') =>
  db
    .prepare('INSERT INTO messages (id, chat_id, ts, kind, body) VALUES (?, ?, ?, ?, ?)')
    .run(id, chat, 1_700_000_000, 'chat', body)

const search = (db: Database.Database, match: string) =>
  db
    .prepare(
      `SELECT d.msg_id, d.source FROM search_fts f
       JOIN search_docs d ON d.rowid = f.rowid
       WHERE search_fts MATCH ? ORDER BY rank`,
    )
    .all(match) as { msg_id: string | null; source: string }[]

describe('migrations', () => {
  it('brings an empty database to the latest version', () => {
    const db = fresh()
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION)
  })

  it('is idempotent', () => {
    const db = fresh()
    expect(migrate(db)).toBe(LATEST_VERSION)
  })

  it('refuses a database written by a newer build', () => {
    // Carrying on would run today's code against tomorrow's schema.
    const db = new Database(':memory:')
    registerFunctions(db)
    db.pragma(`user_version = ${String(LATEST_VERSION + 1)}`)
    expect(() => migrate(db)).toThrow(/only knows/)
  })
})

describe('search index', () => {
  it('indexes a message body through the German normalisation', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Treffen in München, Grüße')

    // Both spellings reach the same document — the whole point of ADR 0002.
    expect(search(db, '"München"').map((r) => r.msg_id)).toEqual(['m1'])
    expect(search(db, '"Muenchen"').map((r) => r.msg_id)).toEqual(['m1'])
    expect(search(db, '"Gruesse"').map((r) => r.msg_id)).toEqual(['m1'])
  })

  it('folds ß so Straße and Strasse are one token', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Hauptstraße 5')
    expect(search(db, '"Hauptstrasse"').map((r) => r.msg_id)).toEqual(['m1'])
  })

  it('does not index an empty or null body', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', null)
    insertMessage(db, 'm2', '')
    expect(db.prepare('SELECT count(*) AS n FROM search_docs').get()).toEqual({ n: 0 })
  })

  it('rewrites the index when a message is edited', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Rechnung')
    db.prepare("UPDATE messages SET body = 'Angebot', edited = 1 WHERE id = 'm1'").run()

    expect(search(db, '"Rechnung"')).toEqual([])
    expect(search(db, '"Angebot"').map((r) => r.msg_id)).toEqual(['m1'])
  })

  it('drops the text from the index when a message is revoked', () => {
    // The row stays — the plan keeps revoked messages and marks them — but the text must not
    // remain findable.
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Geheim')
    db.prepare("UPDATE messages SET revoked = 1 WHERE id = 'm1'").run()

    expect(search(db, '"Geheim"')).toEqual([])
    expect(db.prepare("SELECT count(*) AS n FROM messages WHERE id = 'm1'").get()).toEqual({ n: 1 })
  })

  it('indexes media filenames as their own source', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', null)
    db.prepare(
      "INSERT INTO media (id, msg_id, chat_id, mime, filename) VALUES ('me1','m1','c1','application/pdf','Küchenrechnung.pdf')",
    ).run()

    const hits = search(db, '"Kuechenrechnung.pdf"')
    expect(hits).toEqual([{ msg_id: 'm1', source: 'filename' }])
  })

  it('indexes OCR text and keeps it separate from the body', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Foto')
    db.prepare(
      "INSERT INTO media (id, msg_id, chat_id, mime) VALUES ('me1','m1','c1','image/jpeg')",
    ).run()
    db.prepare(
      "INSERT INTO content_text (msg_id, media_id, source, text, engine) VALUES ('m1','me1','ocr','Gesamtbetrag 49,90 Euro','pp-ocrv5')",
    ).run()

    expect(search(db, '"Gesamtbetrag"')).toEqual([{ msg_id: 'm1', source: 'ocr' }])
    // Filtering by source is what makes "found in the image" possible in the hit list.
    const bySource = db
      .prepare("SELECT count(*) AS n FROM search_docs WHERE msg_id = 'm1' AND source = 'body'")
      .get()
    expect(bySource).toEqual({ n: 1 })
  })

  it('replaces OCR text on re-index without touching other sources', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Foto')
    db.prepare(
      "INSERT INTO media (id, msg_id, chat_id, mime) VALUES ('me1','m1','c1','image/jpeg')",
    ).run()
    const insertOcr = db.prepare(
      "INSERT INTO content_text (msg_id, media_id, source, text, engine_version) VALUES ('m1','me1','ocr',?,?)",
    )
    insertOcr.run('altes Ergebnis', 'v1')
    insertOcr.run('neues Ergebnis', 'v2')

    expect(search(db, '"altes"')).toEqual([])
    expect(search(db, '"neues"')).toEqual([{ msg_id: 'm1', source: 'ocr' }])
    expect(search(db, '"Foto"')).toEqual([{ msg_id: 'm1', source: 'body' }])
  })

  it('removes every document of a message when the message is deleted', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Text')
    db.prepare(
      "INSERT INTO media (id, msg_id, chat_id, filename) VALUES ('me1','m1','c1','a.pdf')",
    ).run()
    db.prepare("DELETE FROM messages WHERE id = 'm1'").run()

    expect(db.prepare("SELECT count(*) AS n FROM search_docs WHERE msg_id = 'm1'").get()).toEqual({
      n: 0,
    })
  })

  it('keeps the fts index consistent with its content table', () => {
    const db = fresh()
    insertChat(db)
    for (let i = 0; i < 50; i++) insertMessage(db, `m${String(i)}`, `Nachricht ${String(i)} Grüße`)
    db.prepare("DELETE FROM messages WHERE id = 'm7'").run()
    db.prepare("UPDATE messages SET body = 'geändert' WHERE id = 'm8'").run()

    // FTS5's own integrity check compares the index against the content table row by row.
    expect(() =>
      db.prepare("INSERT INTO search_fts(search_fts) VALUES('integrity-check')").run(),
    ).not.toThrow()
  })

  it('does not duplicate documents when the same message is imported twice', () => {
    const db = fresh()
    insertChat(db)
    insertMessage(db, 'm1', 'Hallo')
    db.prepare(
      'INSERT INTO messages (id, chat_id, ts, body) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body',
    ).run('m1', 'c1', 1_700_000_000, 'Hallo')

    expect(search(db, '"Hallo"')).toEqual([{ msg_id: 'm1', source: 'body' }])
  })
})
