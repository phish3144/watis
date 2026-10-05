import type { SqlDatabase } from '../archive/sql'
import type { Extraction } from './engine'

/**
 * Writes an extraction, replacing any previous result for this media and source. Replacing is
 * what makes "re-index with the newer engine" leave the other sources alone (§5.4).
 *
 * The one writer of `content_text`: the index runner calls it for OCR and PDF text, and the
 * archive calls it for a transcript made on demand (ADR 0001 §4) — so a transcript reaches the
 * search exactly the way recognised text does.
 */
export function storeExtraction(
  db: SqlDatabase,
  mediaId: string,
  extraction: Extraction,
  now: number,
): void {
  const msgId = (
    db.prepare('SELECT msg_id FROM media WHERE id = ?').get(mediaId) as
      { msg_id: string | null } | undefined
  )?.msg_id

  db.transaction(() => {
    db.prepare('DELETE FROM content_text WHERE media_id = ? AND source = ?').run(
      mediaId,
      extraction.source,
    )

    // An extraction with no text is still a result: it records that the file was looked at, with
    // which engine, so a re-index with a better one can be told apart from never having tried.
    db.prepare(
      `INSERT INTO content_text
         (msg_id, media_id, source, text, detail_json, engine, engine_version, lang, confidence, created_ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msgId ?? null,
      mediaId,
      extraction.source,
      extraction.text,
      // scannedPages goes in beside the lines: the chained OCR job reads it back to learn
      // which pages to render, rather than every engine going to the database for itself.
      JSON.stringify({
        lines: extraction.lines,
        ...('scannedPages' in extraction
          ? { scannedPages: (extraction as { scannedPages?: number[] }).scannedPages }
          : {}),
      }),
      extraction.engine,
      extraction.engineVersion,
      extraction.lang ?? null,
      extraction.confidence ?? null,
      now,
    )
  })()
}
