import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { IndexQueue } from '../../src/workers/content-index/queue'
import { IndexRunner } from '../../src/workers/content-index/runner'
import { PdfEngine } from '../../src/workers/content-index/pdf-engine'
import { TesseractEngine } from '../../src/workers/content-index/ocr-engine'
import type { Engine } from '../../src/workers/content-index/engine'

let db: Database.Database
let queue: IndexQueue

const fixture = (name: string): string => join(process.cwd(), 'test', 'fixtures', name)

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  db.prepare("INSERT INTO chats (id, name, kind) VALUES ('c1','Familie','group')").run()
  db.prepare("INSERT INTO messages (id, chat_id, ts, body) VALUES ('m1','c1',1000,'Anhang')").run()
  queue = new IndexQueue(db)
})

const addMedia = (id: string, mime: string, filename?: string, size = 1000): void => {
  db.prepare(
    "INSERT INTO media (id, msg_id, chat_id, mime, size, filename, status) VALUES (?, 'm1', 'c1', ?, ?, ?, 'done')",
  ).run(id, mime, size, filename ?? null)
}

const searchable = (term: string): unknown[] =>
  db
    .prepare(
      `SELECT d.source FROM search_fts f JOIN search_docs d ON d.rowid = f.rowid WHERE search_fts MATCH ?`,
    )
    .all(term)

describe('IndexRunner', () => {
  it('queues media that has no job and skips what no engine handles', () => {
    addMedia('me1', 'image/jpeg')
    addMedia('me2', 'application/x-tar')
    const runner = new IndexRunner({
      db,
      queue,
      engines: {},
      fileFor: () => Promise.resolve(undefined),
    })

    expect(runner.enqueuePending()).toBe(1)
    expect(queue.counts()).toMatchObject({ queued: 1, skipped: 1 })
  })

  it('skips rather than retries when the engine is missing', async () => {
    // A missing model is permanent; retrying it three times per image just burns the backlog.
    addMedia('me1', 'image/jpeg')
    const runner = new IndexRunner({
      db,
      queue,
      engines: {},
      fileFor: () => Promise.resolve(undefined),
    })
    runner.enqueuePending()

    const outcome = await runner.run()
    expect(outcome).toMatchObject({ processed: 1, skipped: 1, failed: 0 })
    expect(queue.counts().queued).toBe(0)
  })

  it('skips when the blob is not on disk', async () => {
    addMedia('me1', 'image/jpeg')
    const engine: Engine = {
      name: 'x',
      version: '1',
      source: 'ocr',
      isAvailable: () => Promise.resolve(true),
      extract: () => Promise.reject(new Error('should not be called')),
    }
    const runner = new IndexRunner({
      db,
      queue,
      engines: { ocr: engine },
      fileFor: () => Promise.resolve(undefined),
    })
    runner.enqueuePending()

    expect((await runner.run()).skipped).toBe(1)
  })

  it('runs real OCR and makes the text searchable', { timeout: 120_000 }, async () => {
    addMedia('me1', 'image/png', 'rechnung.png')
    const ocr = new TesseractEngine({ tessdataDir: join(process.cwd(), 'resources', 'tessdata') })
    const runner = new IndexRunner({
      db,
      queue,
      engines: { ocr },
      fileFor: () => Promise.resolve({ path: fixture('ocr-rechnung.png'), mime: 'image/png' }),
    })
    runner.enqueuePending()

    expect((await runner.run()).done).toBe(1)
    // The German normalisation applies to OCR text as much as to a message body.
    expect(searchable('"Muenchen"')).toEqual([{ source: 'ocr' }])
    await ocr.close()
  })

  it('runs real PDF extraction and stores the page numbers', { timeout: 60_000 }, async () => {
    addMedia('me1', 'application/pdf', 'angebot.pdf')
    const runner = new IndexRunner({
      db,
      queue,
      engines: { pdf: new PdfEngine() },
      fileFor: () =>
        Promise.resolve({ path: fixture('angebot-text.pdf'), mime: 'application/pdf' }),
    })
    runner.enqueuePending()
    await runner.run()

    // The filename "angebot.pdf" is indexed as its own source, so the term legitimately matches
    // twice; what matters is that the extracted page text is among the hits.
    expect(searchable('"Angebot"')).toContainEqual({ source: 'pdf' })
    expect(searchable('"Zahlungsziel"')).toEqual([{ source: 'pdf' }])
    const row = db.prepare("SELECT detail_json FROM content_text WHERE source = 'pdf'").get() as {
      detail_json: string
    }
    const detail = JSON.parse(row.detail_json) as { lines: { page?: number }[] }
    expect(detail.lines.some((l) => l.page === 2)).toBe(true)
  })

  it('queues OCR for a PDF page that carries no text layer', { timeout: 60_000 }, async () => {
    // A scan is a picture of words, not a page without any — writing it off as empty would lose it.
    addMedia('me1', 'application/pdf', 'scan.pdf')
    const runner = new IndexRunner({
      db,
      queue,
      engines: { pdf: new PdfEngine() },
      fileFor: () =>
        Promise.resolve({ path: fixture('angebot-scan.pdf'), mime: 'application/pdf' }),
    })
    runner.enqueuePending()
    await runner.run(1)

    const ocrJob = db
      .prepare("SELECT media_id, priority FROM index_jobs WHERE kind = 'ocr' AND status = 'queued'")
      .get()
    expect(ocrJob).toMatchObject({ media_id: 'me1' })
  })

  it(
    'does not queue OCR for a PDF that already carries its text',
    { timeout: 60_000 },
    async () => {
      addMedia('me1', 'application/pdf', 'angebot.pdf')
      const runner = new IndexRunner({
        db,
        queue,
        engines: { pdf: new PdfEngine() },
        fileFor: () =>
          Promise.resolve({ path: fixture('angebot-text.pdf'), mime: 'application/pdf' }),
      })
      runner.enqueuePending()
      await runner.run(1)

      expect(db.prepare("SELECT count(*) AS n FROM index_jobs WHERE kind = 'ocr'").get()).toEqual({
        n: 0,
      })
    },
  )

  it('replaces a previous result for the same source without touching the others', async () => {
    addMedia('me1', 'image/jpeg')
    db.prepare(
      "INSERT INTO content_text (msg_id, media_id, source, text, engine) VALUES ('m1','me1','pdf','altes PDF','x')",
    ).run()

    const engine: Engine = {
      name: 'neu',
      version: '2',
      source: 'ocr',
      isAvailable: () => Promise.resolve(true),
      extract: () =>
        Promise.resolve({
          source: 'ocr' as const,
          text: 'frisch erkannt',
          lines: [{ text: 'frisch erkannt' }],
          engine: 'neu',
          engineVersion: '2',
        }),
    }
    const runner = new IndexRunner({
      db,
      queue,
      engines: { ocr: engine },
      fileFor: () => Promise.resolve({ path: '/x', mime: 'image/jpeg' }),
    })
    runner.enqueuePending()
    await runner.run()

    expect(searchable('"frisch"')).toEqual([{ source: 'ocr' }])
    expect(searchable('"altes"')).toEqual([{ source: 'pdf' }])
  })

  it('requeues a failing job and reports it once it gives up', async () => {
    addMedia('me1', 'image/jpeg')
    const engine: Engine = {
      name: 'kaputt',
      version: '1',
      source: 'ocr',
      isAvailable: () => Promise.resolve(true),
      extract: () => Promise.reject(new Error('Bild unlesbar')),
    }
    const log = vi.fn()
    const runner = new IndexRunner({
      db,
      queue,
      engines: { ocr: engine },
      fileFor: () => Promise.resolve({ path: '/x', mime: 'image/jpeg' }),
      log,
    })
    runner.enqueuePending()

    const outcome = await runner.run()
    expect(outcome.failed).toBe(1)
    expect(queue.counts().failed).toBe(1)
    expect(log).toHaveBeenCalled()
  })

  it('stops when asked, leaving the rest queued', async () => {
    for (const id of ['me1', 'me2', 'me3']) addMedia(id, 'image/jpeg')
    const engine: Engine = {
      name: 'x',
      version: '1',
      source: 'ocr',
      isAvailable: () => Promise.resolve(true),
      extract: () => {
        runner.stop()
        return Promise.resolve({
          source: 'ocr' as const,
          text: 't',
          lines: [],
          engine: 'x',
          engineVersion: '1',
        })
      },
    }
    const runner: IndexRunner = new IndexRunner({
      db,
      queue,
      engines: { ocr: engine },
      fileFor: () => Promise.resolve({ path: '/x', mime: 'image/jpeg' }),
    })
    runner.enqueuePending()

    expect((await runner.run()).processed).toBe(1)
    expect(queue.counts().queued).toBe(2)
  })
})
