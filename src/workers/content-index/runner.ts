import type Database from 'better-sqlite3'
import { classify, type Engine, type Extraction } from './engine'
import type { IndexQueue, Job } from './queue'

/**
 * Runs index jobs: claim, extract, store, repeat (PLAN.md Phase 7).
 *
 * Every outcome is recorded. A job that fails goes back with a growing backoff until the attempt
 * limit; a job whose engine is missing is *skipped*, not retried, because a missing model is a
 * permanent condition and retrying it three times per image just burns the backlog.
 */

export interface RunnerDeps {
  db: Database.Database
  queue: IndexQueue
  /** One engine per source; a source with no engine yields skipped jobs. */
  engines: Partial<Record<Job['kind'], Engine>>
  /** Absolute path of the blob for a media row, or undefined when it is not downloaded. */
  fileFor(mediaId: string): Promise<{ path: string; mime: string } | undefined>
  now?: () => number
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

export interface RunOutcome {
  processed: number
  done: number
  failed: number
  skipped: number
}

export class IndexRunner {
  readonly #deps: RunnerDeps
  #stopped = false

  constructor(deps: RunnerDeps) {
    this.#deps = deps
  }

  stop(): void {
    this.#stopped = true
  }

  /** Fills the queue from media rows that have no job yet. */
  enqueuePending(limit = 1000): number {
    const rows = this.#deps.db
      .prepare(
        `SELECT m.id, m.mime, m.size, m.filename
         FROM media m
         WHERE m.status = 'done'
           AND NOT EXISTS (SELECT 1 FROM index_jobs j WHERE j.media_id = m.id)
         LIMIT ?`,
      )
      .all(limit) as {
      id: string
      mime: string | null
      size: number | null
      filename: string | null
    }[]

    const now = this.#deps.now?.() ?? 0
    let added = 0
    for (const row of rows) {
      const decision = classify(row.mime, row.size, row.filename)
      if ('skip' in decision) {
        // Recorded once so it is never looked at again.
        this.#deps.queue.skip(row.id, 'text', decision.skip, now)
        continue
      }
      this.#deps.queue.enqueue(row.id, decision.source, decision.priority, now)
      added++
    }
    return added
  }

  /** Works the queue until it is empty, `max` jobs are done, or stop() is called. */
  async run(max = Number.POSITIVE_INFINITY): Promise<RunOutcome> {
    const outcome: RunOutcome = { processed: 0, done: 0, failed: 0, skipped: 0 }
    this.#stopped = false

    while (!this.#stopped && outcome.processed < max) {
      const now = this.#deps.now?.() ?? 0
      const job = this.#deps.queue.claim(now)
      if (!job) break
      outcome.processed++

      const engine = this.#deps.engines[job.kind]
      if (!engine || !(await engine.isAvailable())) {
        // No engine is permanent: skip rather than fail, so the job does not come back three times.
        this.#deps.queue.skip(job.mediaId, job.kind, `no engine for ${job.kind}`, now)
        this.#deps.queue.complete(job.id, now)
        outcome.skipped++
        continue
      }

      const file = await this.#deps.fileFor(job.mediaId)
      if (!file) {
        this.#deps.queue.skip(job.mediaId, job.kind, 'blob is not present', now)
        this.#deps.queue.complete(job.id, now)
        outcome.skipped++
        continue
      }

      try {
        const extraction = await engine.extract(file.path, file.mime)
        this.#store(job, extraction, now)
        this.#chainScannedPages(job, extraction, now)
        this.#deps.queue.complete(job.id, now)
        outcome.done++
      } catch (error) {
        const result = this.#deps.queue.fail(job.id, String(error), now)
        if (result === 'failed') outcome.failed++
        this.#deps.log?.('warn', `index job ${String(job.id)} ${result}: ${String(error)}`)
      }
    }

    return outcome
  }

  /**
   * A PDF page with no text layer is a scan — a picture of words, not a page without any. It gets
   * its own OCR job rather than being written off as empty (ADR 0005 C, ADR 0008).
   */
  #chainScannedPages(job: Job, extraction: Extraction, now: number): void {
    if (job.kind !== 'pdf') return
    const pages = (extraction as { scannedPages?: number[] }).scannedPages ?? []
    if (pages.length === 0) return

    // Lower priority than a fresh document: rendering and recognising pages is the expensive path,
    // and it should not hold up documents that carry their text already.
    this.#deps.queue.enqueue(job.mediaId, 'ocr', 15, now)
    this.#deps.log?.(
      'info',
      `pdf ${job.mediaId}: ${String(pages.length)} page(s) without a text layer queued for OCR`,
    )
  }

  /**
   * Writes the extraction, replacing any previous result for this media and source. Replacing is
   * what makes "re-index with the newer engine" leave the other sources alone (§5.4).
   */
  #store(job: Job, extraction: Extraction, now: number): void {
    const msgId = (
      this.#deps.db.prepare('SELECT msg_id FROM media WHERE id = ?').get(job.mediaId) as
        { msg_id: string | null } | undefined
    )?.msg_id

    this.#deps.db.transaction(() => {
      this.#deps.db
        .prepare('DELETE FROM content_text WHERE media_id = ? AND source = ?')
        .run(job.mediaId, extraction.source)

      // An extraction with no text is still a result: it records that the file was looked at, with
      // which engine, so a re-index with a better one can be told apart from never having tried.
      this.#deps.db
        .prepare(
          `INSERT INTO content_text
             (msg_id, media_id, source, text, detail_json, engine, engine_version, lang, confidence, created_ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          msgId ?? null,
          job.mediaId,
          extraction.source,
          extraction.text,
          JSON.stringify({ lines: extraction.lines }),
          extraction.engine,
          extraction.engineVersion,
          extraction.lang ?? null,
          extraction.confidence ?? null,
          now,
        )
    })()
  }
}
