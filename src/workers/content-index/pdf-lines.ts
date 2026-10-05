import type { Extraction, ExtractedLine } from './engine'

/**
 * The pure half of PDF text extraction: turning pdf.js's positioned fragments into lines, and
 * deciding which pages are scans. Shared by the desktop's PDF engine and the browser extension's,
 * which load pdf.js differently but must read a PDF the same way (ADR 0010).
 */

export interface PdfExtraction extends Extraction {
  pageCount: number
  /** 1-based pages that produced no text and therefore need OCR. */
  scannedPages: number[]
}

/** Below this a "page of text" is more plausibly a page number than a text layer. */
export const MIN_CHARS_PER_PAGE = 12

export interface TextItem {
  str?: string
  transform?: number[]
  hasEOL?: boolean
}

/**
 * pdf.js reports positioned fragments, not lines. Grouping by the vertical position in the text
 * matrix reassembles them; without it a two-column invoice comes out interleaved word by word.
 */
export function groupIntoLines(items: readonly TextItem[], page: number): ExtractedLine[] {
  const rows = new Map<number, string[]>()

  for (const item of items) {
    const text = item.str ?? ''
    if (text === '') continue
    // transform[5] is the y translation. Rounding folds the sub-pixel jitter that would otherwise
    // split one visual line into several.
    const y = Math.round(item.transform?.[5] ?? 0)
    const row = rows.get(y)
    if (row) row.push(text)
    else rows.set(y, [text])
  }

  return (
    [...rows.entries()]
      // PDF y grows upwards, so descending y is top-to-bottom reading order.
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => ({ text: parts.join(' ').replace(/\s+/g, ' ').trim(), page }))
      .filter((line) => line.text !== '')
  )
}
