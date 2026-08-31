import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { IndexQueue } from '../../src/workers/content-index/queue'
import { IndexRunner } from '../../src/workers/content-index/runner'
import { PdfEngine } from '../../src/workers/content-index/pdf-engine'
import { TesseractEngine } from '../../src/workers/content-index/ocr-engine'
import { ScannedPdfEngine } from '../../src/workers/content-index/scanned-pdf-engine'
import type { Engine, Extraction, ExtractionHint } from '../../src/workers/content-index/engine'

/**
 * A PDF with no text layer is a picture of words. This covers the whole chain: the PDF engine finds
 * the empty pages, the runner records them, the chained OCR job reads them back and only those
 * pages are rendered.
 *
 * The renderer is faked here. Rasterising needs Electron's canvas, which vitest does not have —
 * `test/e2e/` is where that half runs. What this pins down is the part that decides *which* pages
 * are rendered, which is where a fifty-page contract turns into two pages of work or fifty.
 */

const fixture = (name: string): string => join(process.cwd(), 'test', 'fixtures', name)
const tessdataDir = join(process.cwd(), 'resources', 'tessdata')

let db: Database.Database
let queue: IndexQueue
let rendered: { file: string; pages: number[] }[]
const ocr = new TesseractEngine({ tessdataDir })

afterAll(async () => {
  await ocr.close()
})

/** Stands in for Electron: hands back the OCR fixture as the image of every page asked for. */
const fakeRenderer = async (
  file: string,
  pages: number[],
): Promise<{ page: number; data: string }[]> => {
  rendered.push({ file, pages })
  const { readFile } = await import('node:fs/promises')
  const png = await readFile(fixture('ocr-rechnung.png'))
  return pages.map((page) => ({ page, data: png.toString('base64') }))
}

class Router implements Engine {
  readonly name = 'ocr'
  readonly source = 'ocr' as const
  readonly version = '1'
  constructor(private readonly scans: ScannedPdfEngine) {}
  isAvailable(): Promise<boolean> {
    return ocr.isAvailable()
  }
  extract(file: string, mime: string, hint?: ExtractionHint): Promise<Extraction> {
    return hint?.scannedPages?.length ? this.scans.extract(file, mime, hint) : ocr.extract(file)
  }
}

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  queue = new IndexQueue(db)
  rendered = []

  db.prepare(
    `INSERT INTO messages (id, chat_id, ts, media_id) VALUES ('m1', 'c1', 1000, 'd1')`,
  ).run()
})

const runnerFor = (file: string): IndexRunner =>
  new IndexRunner({
    db,
    queue,
    engines: { pdf: new PdfEngine(), ocr: new Router(new ScannedPdfEngine(ocr, fakeRenderer)) },
    fileFor: () => Promise.resolve({ path: file, mime: 'application/pdf' }),
    now: () => 0,
  })

describe('the scanned-PDF chain', () => {
  it('records which pages had no text layer', { timeout: 60_000 }, async () => {
    db.prepare(
      `INSERT INTO media (id, msg_id, chat_id, mime, filename, status)
       VALUES ('d1', 'm1', 'c1', 'application/pdf', 'scan.pdf', 'done')`,
    ).run()
    queue.enqueue('d1', 'pdf', 0, 0)

    await runnerFor(fixture('angebot-scan.pdf')).run(1)

    const row = db
      .prepare(`SELECT detail_json FROM content_text WHERE media_id = 'd1' AND source = 'pdf'`)
      .get() as { detail_json: string }
    const detail = JSON.parse(row.detail_json) as { scannedPages?: number[] }
    expect(detail.scannedPages?.length).toBeGreaterThan(0)
  })

  it(
    'renders only the pages that had none, and recognises them',
    { timeout: 180_000 },
    async () => {
      db.prepare(
        `INSERT INTO media (id, msg_id, chat_id, mime, filename, status)
       VALUES ('d1', 'm1', 'c1', 'application/pdf', 'scan.pdf', 'done')`,
      ).run()
      queue.enqueue('d1', 'pdf', 0, 0)

      const runner = runnerFor(fixture('angebot-scan.pdf'))
      await runner.run(1)
      // The PDF job chained an OCR job for the same file.
      await runner.run(1)

      expect(rendered).toHaveLength(1)
      expect(rendered[0]?.pages.length).toBeGreaterThan(0)

      const row = db
        .prepare(
          `SELECT text, detail_json FROM content_text WHERE media_id = 'd1' AND source = 'ocr'`,
        )
        .get() as { text: string; detail_json: string } | undefined
      expect(row?.text.toLowerCase()).toContain('rechnung')

      // Every line carries the page it came from, which is what makes a hit in a long scan useful.
      const lines = (JSON.parse(row?.detail_json ?? '{}') as { lines?: { page?: number }[] }).lines
      expect(lines?.every((l) => typeof l.page === 'number')).toBe(true)
    },
  )

  it('leaves a PDF that carried its own text alone', { timeout: 60_000 }, async () => {
    // A document whose text extraction worked has no business going through recognition.
    db.prepare(
      `INSERT INTO media (id, msg_id, chat_id, mime, filename, status)
       VALUES ('d1', 'm1', 'c1', 'application/pdf', 'text.pdf', 'done')`,
    ).run()
    queue.enqueue('d1', 'pdf', 0, 0)

    const runner = runnerFor(fixture('angebot-text.pdf'))
    await runner.run(5)
    expect(rendered).toHaveLength(0)
  })

  it('recognises nothing rather than everything when it is given no pages', async () => {
    const engine = new ScannedPdfEngine(ocr, fakeRenderer)
    const result = await engine.extract(fixture('angebot-scan.pdf'), 'application/pdf')
    expect(result.text).toBe('')
    expect(rendered).toHaveLength(0)
  })
})
