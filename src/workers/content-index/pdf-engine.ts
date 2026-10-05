import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { joinLines, type Engine, type ExtractedLine } from './engine'
import { MIN_CHARS_PER_PAGE, groupIntoLines, type PdfExtraction, type TextItem } from './pdf-lines'

export type { PdfExtraction }

/**
 * PDF text extraction via pdf.js (ADR 0008).
 *
 * The legacy build is the one that runs under Node without a DOM. Worker threads are disabled for
 * the same reason: we are already inside a utility process whose whole job is this, and pdf.js's
 * own worker would add a second layer of message passing for nothing.
 *
 * A page with no text layer yields nothing here — that is a scan, and it belongs in the OCR queue.
 * `scannedPages` says which ones, so the caller can enqueue exactly those (ADR 0005 C).
 */

const VERSION = '6.3.289'

export class PdfEngine implements Engine {
  readonly name = 'pdfjs'
  readonly version = VERSION
  readonly source = 'pdf' as const

  readonly #maxPages: number

  constructor(options: { maxPages?: number } = {}) {
    // A thousand-page document would otherwise hold the queue for minutes.
    this.#maxPages = options.maxPages ?? 200
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  async extract(file: string): Promise<PdfExtraction> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(await readFile(file))

    // Point the worker at the bundled build. Without this pdf.js reaches for a CDN, which the
    // project's network rules forbid; the legacy build is the one that runs under Node.
    // Resolved through require, because a bare specifier in `new URL` is treated as a relative
    // path and lands beside this file rather than in node_modules.
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
      createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href

    const task = pdfjs.getDocument({
      data,
      // Fonts and rendering are irrelevant to text extraction, and skipping them is a large saving
      // on scanned documents in particular.
      disableFontFace: true,
      useWorkerFetch: false,
    })
    const document = await task.promise

    const pageCount = document.numPages
    const lines: ExtractedLine[] = []
    const scannedPages: number[] = []

    for (let pageNumber = 1; pageNumber <= Math.min(pageCount, this.#maxPages); pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()

      const pageLines = groupIntoLines(content.items as TextItem[], pageNumber)
      const charCount = pageLines.reduce((sum, l) => sum + l.text.trim().length, 0)

      if (charCount < MIN_CHARS_PER_PAGE) scannedPages.push(pageNumber)
      else lines.push(...pageLines)

      page.cleanup()
    }
    await task.destroy()

    return {
      source: 'pdf',
      text: joinLines(lines),
      lines,
      engine: this.name,
      engineVersion: this.version,
      pageCount,
      scannedPages,
    }
  }
}
