import { createWorker, type Worker as TesseractWorker } from 'tesseract.js'
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  extractPlainText,
  joinLines,
  type Engine,
  type Extraction,
  type ExtractedLine,
} from '../../workers/content-index/engine'
import { toExtraction } from '../../workers/content-index/ocr-lines'
import { OcrRouter } from '../../workers/content-index/ocr-router'
import {
  MIN_CHARS_PER_PAGE,
  groupIntoLines,
  type PdfExtraction,
  type TextItem,
} from '../../workers/content-index/pdf-lines'
import { ScannedPdfEngine, type RenderedPage } from '../../workers/content-index/scanned-pdf-engine'

/**
 * The extraction engines in the browser, keyed by index source (ADR 0010).
 *
 * The same libraries as the desktop — tesseract.js for pictures, pdf.js for PDFs — loaded the way a
 * browser can: every file ships inside the extension (`ocr/` in the package), nothing comes from a
 * CDN (CLAUDE.md, "Datenschutz und Netz"), and no worker is started from a blob: URL, which the
 * extension's CSP forbids. Each engine receives the blob's OPFS path where the desktop engines get
 * a disk path, and reads the file itself.
 *
 * They run inside the archive worker, beside the database the results go into. tesseract.js and
 * pdf.js start their own workers from there.
 */

const ASSETS = `${self.location.origin}/ocr`
const TESSERACT_VERSION = '7.0.0'
const PDFJS_VERSION = '6.3.289'

/** Opens a file by its path relative to the extension's OPFS root. */
export async function readOpfs(path: string): Promise<File> {
  const parts = path.split('/')
  const name = parts.pop()
  if (!name) throw new Error(`not a file path: ${path}`)
  let dir = await navigator.storage.getDirectory()
  for (const part of parts) dir = await dir.getDirectoryHandle(part)
  return (await dir.getFileHandle(name)).getFile()
}

/** TXT, Markdown, CSV: reading the file is the whole job. */
export const textEngine: Engine = {
  name: 'builtin-text',
  version: '1',
  source: 'text',
  isAvailable: () => Promise.resolve(true),
  extract: async (path: string): Promise<Extraction> =>
    extractPlainText(await (await readOpfs(path)).text()),
}

/** Text in pictures. One Tesseract worker, started on first use and kept (ADR 0008). */
export class BrowserOcrEngine implements Engine {
  readonly name = 'tesseract'
  readonly version = TESSERACT_VERSION
  readonly source = 'ocr' as const
  readonly #languages = 'deu+eng'
  readonly #minConfidence = 40
  #worker: Promise<TesseractWorker> | undefined

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  /** `input` is an OPFS path, or a data: URL for a rendered PDF page. */
  async extract(input: string): Promise<Extraction> {
    const worker = await this.#ensureWorker()
    const image = input.startsWith('data:') ? input : await readOpfs(input)
    const result = await worker.recognize(image, {}, { blocks: true, text: true })
    return toExtraction(result.data, {
      engine: this.name,
      version: this.version,
      languages: this.#languages,
      minConfidence: this.#minConfidence,
    })
  }

  #ensureWorker(): Promise<TesseractWorker> {
    this.#worker ??= createWorker(this.#languages, 1, {
      workerPath: `${ASSETS}/worker.min.js`,
      // One core, the SIMD build: every browser this supports (Chrome 116+, Firefox 128+) has
      // WASM SIMD, and shipping the three fallbacks would triple the package for nobody.
      corePath: `${ASSETS}/tesseract-core-simd-lstm.wasm.js`,
      langPath: `${ASSETS}/lang`,
      gzip: false,
      workerBlobURL: false,
      // The language data is already in the package; a second copy in IndexedDB buys nothing.
      cacheMethod: 'none',
    })
    return this.#worker
  }
}

type PdfJs = typeof PdfJsModule

let pdfjs: Promise<PdfJs> | undefined
function loadPdfJs(): Promise<PdfJs> {
  // The legacy build, as on the desktop: the modern one relies on brand-new built-ins
  // (Map.prototype.getOrInsertComputed) that Chromium 141 does not have yet.
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((module) => {
    // Handed a port rather than a URL: pdf.js's own worker setup looks for a window to compare
    // origins against, finds none inside a worker, and falls back to parsing on this thread — the
    // thread that also answers searches.
    module.GlobalWorkerOptions.workerPort = new Worker(`${ASSETS}/pdf.worker.min.mjs`, {
      type: 'module',
    })
    return module
  })
  return pdfjs
}

/** Text layers of PDFs; pages without one are reported as scans for the OCR queue (ADR 0005 C). */
export class BrowserPdfEngine implements Engine {
  readonly name = 'pdfjs'
  readonly version = PDFJS_VERSION
  readonly source = 'pdf' as const
  readonly #maxPages = 200

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true)
  }

  async extract(path: string): Promise<PdfExtraction> {
    const { getDocument } = await loadPdfJs()
    const data = new Uint8Array(await (await readOpfs(path)).arrayBuffer())
    const task = getDocument({ data, disableFontFace: true, useWorkerFetch: false })
    const document = await task.promise
    const lines: ExtractedLine[] = []
    const scannedPages: number[] = []
    for (
      let pageNumber = 1;
      pageNumber <= Math.min(document.numPages, this.#maxPages);
      pageNumber++
    ) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const pageLines = groupIntoLines(content.items as TextItem[], pageNumber)
      const chars = pageLines.reduce((sum, line) => sum + line.text.trim().length, 0)
      if (chars < MIN_CHARS_PER_PAGE) scannedPages.push(pageNumber)
      else lines.push(...pageLines)
      page.cleanup()
    }
    const pageCount = document.numPages
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

/**
 * pdf.js draws into canvases it creates itself; in a worker there is no document to create them
 * from, so it is handed OffscreenCanvas instead.
 */
class OffscreenCanvasFactory {
  create(
    width: number,
    height: number,
  ): { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D } {
    const canvas = new OffscreenCanvas(Math.max(1, width), Math.max(1, height))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    return { canvas, context }
  }

  reset(target: { canvas: OffscreenCanvas }, width: number, height: number): void {
    target.canvas.width = Math.max(1, width)
    target.canvas.height = Math.max(1, height)
  }

  destroy(target: { canvas: OffscreenCanvas | null; context: unknown }): void {
    if (target.canvas) {
      target.canvas.width = 0
      target.canvas.height = 0
    }
    target.canvas = null
    target.context = null
  }
}

/** Renders the scanned pages of a PDF for the OCR, the browser's stand-in for Electron's canvas. */
async function renderPages(path: string, pages: number[]): Promise<RenderedPage[]> {
  const { getDocument } = await loadPdfJs()
  const data = new Uint8Array(await (await readOpfs(path)).arrayBuffer())
  const task = getDocument({
    data,
    isOffscreenCanvasSupported: true,
    CanvasFactory: OffscreenCanvasFactory,
  })
  const document = await task.promise
  const rendered: RenderedPage[] = []
  for (const number of pages) {
    const page = await document.getPage(number)
    // About 200 dpi for an A4 page: enough for Tesseract, small enough to stay quick.
    const viewport = page.getViewport({ scale: 2.5 })
    const factory = new OffscreenCanvasFactory()
    const { canvas, context } = factory.create(viewport.width, viewport.height)
    await page.render({ canvas: canvas as never, canvasContext: context as never, viewport })
      .promise
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    rendered.push({ page: number, data: toBase64(new Uint8Array(await blob.arrayBuffer())) })
    page.cleanup()
  }
  await task.destroy()
  return rendered
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

export function browserEngines(): Partial<Record<string, Engine>> {
  const ocr = new BrowserOcrEngine()
  return {
    text: textEngine,
    pdf: new BrowserPdfEngine(),
    ocr: new OcrRouter(ocr, new ScannedPdfEngine(ocr, renderPages)),
  }
}
