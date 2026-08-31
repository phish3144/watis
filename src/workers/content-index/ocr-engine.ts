import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorker, type Worker } from 'tesseract.js'
import {
  joinLines,
  meanConfidence,
  type Engine,
  type Extraction,
  type ExtractedLine,
} from './engine'

/**
 * OCR via Tesseract (ADR 0008).
 *
 * Two things matter more than the recognition quality here:
 *
 *  - **No network.** tesseract.js fetches its language data from a CDN by default. The project
 *    forbids that outright, so `langPath` points at the bundled `resources/tessdata` and `gzip` is
 *    off, because what we ship is the plain `.traineddata`.
 *  - **The worker is expensive to start** — it loads a WASM core and a language model — so one is
 *    kept alive across jobs and only torn down on shutdown.
 */

export interface OcrOptions {
  /** Directory holding deu.traineddata and eng.traineddata. */
  tessdataDir: string
  /** Recognition languages, in Tesseract's `+`-joined form. */
  languages?: string
  /** Lines below this are dropped before they reach the index. */
  minConfidence?: number
}

const VERSION = '7.0.0'

export class TesseractEngine implements Engine {
  readonly name = 'tesseract'
  readonly version = VERSION
  readonly source = 'ocr' as const

  readonly #options: Required<OcrOptions>
  #worker: Worker | undefined
  #unavailable: string | undefined

  constructor(options: OcrOptions) {
    this.#options = {
      tessdataDir: options.tessdataDir,
      languages: options.languages ?? 'deu+eng',
      minConfidence: options.minConfidence ?? 40,
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.#unavailable !== undefined) return false
    for (const lang of this.#options.languages.split('+')) {
      try {
        await readFile(join(this.#options.tessdataDir, `${lang}.traineddata`))
      } catch {
        // A missing model is a permanent condition, not a transient failure — the queue must skip
        // rather than retry it three times per image.
        this.#unavailable = `missing ${lang}.traineddata in ${this.#options.tessdataDir}`
        return false
      }
    }
    return true
  }

  async extract(file: string): Promise<Extraction> {
    const worker = await this.#ensureWorker()
    // `blocks` has to be asked for: without it the result carries only the flat text, and the
    // per-line boxes are what let a hit point at the place in the image it came from.
    const result = await worker.recognize(file, {}, { blocks: true, text: true })

    const lines: ExtractedLine[] = (result.data.blocks ?? [])
      .flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .filter((line) => line.confidence >= this.#options.minConfidence)
      .map((line) => ({
        text: line.text.replace(/\s+$/, ''),
        box: [line.bbox.x0, line.bbox.y0, line.bbox.x1, line.bbox.y1] as const,
        confidence: line.confidence / 100,
      }))

    return {
      source: 'ocr',
      text: joinLines(lines),
      lines,
      engine: this.name,
      engineVersion: this.version,
      lang: this.#options.languages,
      ...(meanConfidence(lines) !== undefined ? { confidence: meanConfidence(lines) } : {}),
    }
  }

  async close(): Promise<void> {
    await this.#worker?.terminate()
    this.#worker = undefined
  }

  async #ensureWorker(): Promise<Worker> {
    if (this.#worker) return this.#worker
    this.#worker = await createWorker(this.#options.languages, undefined, {
      langPath: this.#options.tessdataDir,
      // We ship the plain .traineddata, not the gzipped form the CDN serves.
      gzip: false,
    })
    return this.#worker
  }
}
