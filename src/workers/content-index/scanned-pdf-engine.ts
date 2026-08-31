import {
  joinLines,
  meanConfidence,
  type Engine,
  type Extraction,
  type ExtractedLine,
  type ExtractionHint,
} from './engine'
import type { TesseractEngine } from './ocr-engine'

/**
 * Text recognition for PDFs that carry no text layer (PLAN.md Phase 7, ADR 0005 C).
 *
 * A scanned page is a picture of words. `pdf-engine.ts` already reports which pages have no text;
 * this renders exactly those and recognises them. It renders nothing else — a fifty-page contract
 * with two scanned appendices costs two pages of work, not fifty.
 *
 * Rasterising needs a canvas, which a Node worker does not have. Rather than adding a native canvas
 * module for one feature, the render is asked of the main process, which has Electron's. That is
 * what the narrow host-request channel exists for.
 */

export interface RenderedPage {
  page: number
  /** PNG bytes, base64. */
  data: string
}

export type PageRenderer = (file: string, pages: number[]) => Promise<RenderedPage[]>

export class ScannedPdfEngine implements Engine {
  readonly name = 'tesseract-on-rendered-pdf'
  readonly source = 'ocr' as const

  readonly #ocr: TesseractEngine
  readonly #render: PageRenderer

  constructor(ocr: TesseractEngine, render: PageRenderer) {
    this.#ocr = ocr
    this.#render = render
  }

  get version(): string {
    return this.#ocr.version
  }

  isAvailable(): Promise<boolean> {
    // Only the recognition can be missing; the renderer is part of the application.
    return this.#ocr.isAvailable()
  }

  /**
   * `pages` comes from the PDF engine's `scannedPages`. Given none, this recognises nothing rather
   * than guessing: a PDF whose text extraction succeeded has no business going through OCR.
   */
  async extract(file: string, _mime: string, hint?: ExtractionHint): Promise<Extraction> {
    const wanted = [...(hint?.scannedPages ?? [])]
    if (wanted.length === 0) {
      return {
        source: 'ocr',
        text: '',
        lines: [],
        engine: this.name,
        engineVersion: this.version,
      }
    }

    const rendered = await this.#render(file, wanted)
    const lines: ExtractedLine[] = []

    for (const image of rendered) {
      // A data URL rather than a temporary file: tesseract.js accepts one, and writing every page
      // of every scanned document to disk to read it straight back would be work for nothing.
      const result = await this.#ocr.extract(`data:image/png;base64,${image.data}`)
      for (const line of result.lines) {
        // The page number is what makes a hit in a hundred-page scan useful.
        lines.push({ ...line, page: image.page })
      }
    }

    return {
      source: 'ocr',
      text: joinLines(lines),
      lines,
      engine: this.name,
      engineVersion: this.version,
      ...(meanConfidence(lines) !== undefined ? { confidence: meanConfidence(lines) } : {}),
    }
  }
}
