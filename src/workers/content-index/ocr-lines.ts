import { joinLines, meanConfidence, type Extraction, type ExtractedLine } from './engine'

/**
 * Turning a Tesseract result into an extraction: lines with their boxes, below-threshold lines
 * dropped, confidence on the 0–1 scale the archive stores. Shared by the desktop engine and the
 * browser extension's, so the same picture yields the same searchable text in both (ADR 0010).
 */

/** The part of tesseract.js's result this reads. */
export interface RecognizedPage {
  blocks?:
    | {
        paragraphs: {
          lines: {
            text: string
            confidence: number
            bbox: { x0: number; y0: number; x1: number; y1: number }
          }[]
        }[]
      }[]
    | null
}

export function toExtraction(
  page: RecognizedPage,
  options: { engine: string; version: string; languages: string; minConfidence: number },
): Extraction {
  const lines: ExtractedLine[] = (page.blocks ?? [])
    .flatMap((block) => block.paragraphs)
    .flatMap((paragraph) => paragraph.lines)
    .filter((line) => line.confidence >= options.minConfidence)
    .map((line) => ({
      text: line.text.replace(/\s+$/, ''),
      box: [line.bbox.x0, line.bbox.y0, line.bbox.x1, line.bbox.y1] as const,
      confidence: line.confidence / 100,
    }))

  const confidence = meanConfidence(lines)
  return {
    source: 'ocr',
    text: joinLines(lines),
    lines,
    engine: options.engine,
    engineVersion: options.version,
    lang: options.languages,
    ...(confidence !== undefined ? { confidence } : {}),
  }
}
