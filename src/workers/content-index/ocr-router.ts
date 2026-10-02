import type { Engine, Extraction, ExtractionHint } from './engine'

/**
 * One `ocr` job can be either a picture or a PDF whose pages need rendering first. The router
 * decides on the hint rather than on the file extension: the hint is written by the PDF extraction
 * that found the empty pages, so it is the thing that actually knows.
 *
 * Engine-agnostic, so the desktop (tesseract.js under Node) and the browser extension (tesseract.js
 * in a worker) route the same way.
 */
export class OcrRouter implements Engine {
  readonly name = 'ocr'
  readonly source = 'ocr' as const

  constructor(
    private readonly images: Engine,
    private readonly scans: Engine,
  ) {}

  get version(): string {
    return this.images.version
  }

  isAvailable(): Promise<boolean> {
    return this.images.isAvailable()
  }

  extract(file: string, mime: string, hint?: ExtractionHint): Promise<Extraction> {
    return hint?.scannedPages?.length
      ? this.scans.extract(file, mime, hint)
      : this.images.extract(file, mime)
  }
}
