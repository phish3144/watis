/**
 * The extraction engines behind one interface (PLAN.md Phase 7).
 *
 * The interface exists so the engine can be swapped without touching the queue, the schema or the
 * search — PP-OCRv5 today, something else in two years, and a re-index per source and engine version
 * rather than a rebuild of everything (§5.4).
 */

export type ExtractionSource = 'ocr' | 'pdf' | 'docx' | 'text' | 'transcript'

export interface ExtractedLine {
  text: string
  /** Where it was found: pixel box for OCR, page for PDF, seconds for audio. */
  box?: readonly [number, number, number, number] | undefined
  page?: number | undefined
  startSeconds?: number | undefined
  endSeconds?: number | undefined
  /** 0–1. Engines that report another scale normalise before returning. */
  confidence?: number | undefined
}

export interface Extraction {
  source: ExtractionSource
  text: string
  lines: ExtractedLine[]
  engine: string
  engineVersion: string
  lang?: string | undefined
  /** Mean confidence across lines, where the engine reports one. */
  confidence?: number | undefined
}

export interface ExtractionHint {
  /** 1-based page numbers with no text layer, from a previous `pdf` extraction. */
  scannedPages?: readonly number[]
}

export interface Engine {
  readonly name: string
  readonly version: string
  readonly source: ExtractionSource
  /** False when a model is missing or the platform cannot run it; the queue then skips rather than retries. */
  isAvailable(): Promise<boolean>
  /**
   * `hint` carries what a source needs and the others ignore. Today that is the list of pages a
   * PDF reported as having no text layer — the alternative was for each engine to go and read the
   * previous extraction itself, which would give every engine a reason to touch the database.
   */
  extract(file: string, mime: string, hint?: ExtractionHint): Promise<Extraction>
}

/** Joins lines into the text that goes into `content_text.text` and from there into the index. */
export function joinLines(lines: readonly ExtractedLine[]): string {
  return lines
    .map((l) => l.text.trim())
    .filter((t) => t !== '')
    .join('\n')
}

export function meanConfidence(lines: readonly ExtractedLine[]): number | undefined {
  const values = lines.map((l) => l.confidence).filter((c): c is number => typeof c === 'number')
  if (values.length === 0) return undefined
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Plain text, CSV and Markdown need no engine and no dependency — reading the file is the whole job.
 * Bounded, because a multi-gigabyte log pasted into a chat must not become a multi-gigabyte row.
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function extractPlainText(content: string, maxBytes = MAX_TEXT_BYTES): Extraction {
  const truncated = Buffer.byteLength(content, 'utf8') > maxBytes
  const text = truncated
    ? Buffer.from(content, 'utf8').subarray(0, maxBytes).toString('utf8')
    : content
  return {
    source: 'text',
    text,
    lines: text.split(/\r?\n/).map((line) => ({ text: line })),
    engine: 'builtin-text',
    engineVersion: '1',
  }
}

/**
 * Whether a file is worth queueing at all. Skipping is a decision recorded once, not a failure
 * retried forever: stickers, huge files and types no engine handles never become work.
 */
export function classify(
  mime: string | null | undefined,
  size: number | null | undefined,
  filename?: string | null,
): { source: ExtractionSource; priority: number } | { skip: string } {
  const type = (mime ?? '').toLowerCase()
  const name = (filename ?? '').toLowerCase()

  if (name.endsWith('.webp') || type === 'image/webp') return { skip: 'sticker or webp' }
  if (size != null && size > 200 * 1024 * 1024) return { skip: 'larger than 200 MB' }

  // Documents before images (§7): a PDF usually carries more searchable text than a photo.
  if (type === 'application/pdf' || name.endsWith('.pdf')) return { source: 'pdf', priority: 30 }
  if (type.includes('wordprocessingml') || name.endsWith('.docx'))
    return { source: 'docx', priority: 30 }
  if (type.startsWith('text/') || /\.(txt|md|csv|log)$/.test(name))
    return { source: 'text', priority: 40 }
  if (type.startsWith('image/')) return { source: 'ocr', priority: 20 }
  if (type.startsWith('audio/')) return { source: 'transcript', priority: 10 }

  return { skip: `no engine for ${type || 'unknown type'}` }
}
