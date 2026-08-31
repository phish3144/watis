import type Database from 'better-sqlite3'

/**
 * The index job queue (PLAN.md Phase 7), backed by `index_jobs`.
 *
 * State lives in the database rather than in memory, so a crash mid-run costs one job rather than
 * the whole backlog, and the progress the storage overview shows is the real one.
 */

export interface Job {
  id: number
  mediaId: string
  kind: 'ocr' | 'pdf' | 'docx' | 'text' | 'transcript'
  attempts: number
}

export interface QueueCounts {
  queued: number
  running: number
  done: number
  failed: number
  skipped: number
}

export class IndexQueue {
  readonly #db: Database.Database
  readonly #maxAttempts: number

  constructor(db: Database.Database, maxAttempts = 3) {
    this.#db = db
    this.#maxAttempts = maxAttempts
  }

  /** Adds a job unless one already exists for that media and kind. */
  enqueue(mediaId: string, kind: Job['kind'], priority = 0, now = 0): number {
    const existing = this.#db
      .prepare('SELECT id FROM index_jobs WHERE media_id = ? AND kind = ?')
      .get(mediaId, kind) as { id: number } | undefined
    if (existing) return existing.id

    const info = this.#db
      .prepare(
        `INSERT INTO index_jobs (media_id, kind, priority, attempts, status, updated_ts)
         VALUES (?, ?, ?, 0, 'queued', ?)`,
      )
      .run(mediaId, kind, priority, now)
    return Number(info.lastInsertRowid)
  }

  /** Records a decision not to index, so it is never retried. */
  skip(mediaId: string, kind: Job['kind'], reason: string, now = 0): void {
    this.#db
      .prepare(
        `INSERT INTO index_jobs (media_id, kind, priority, attempts, status, last_error, updated_ts)
         VALUES (?, ?, 0, 0, 'skipped', ?, ?)`,
      )
      .run(mediaId, kind, reason, now)
  }

  /**
   * Claims the next job: highest priority, newest first within a priority. Claiming and marking
   * running happen in one transaction, so two workers cannot take the same job.
   */
  claim(now = 0): Job | undefined {
    return this.#db.transaction((): Job | undefined => {
      const row = this.#db
        .prepare(
          `SELECT j.id, j.media_id, j.kind, j.attempts
           FROM index_jobs j
           LEFT JOIN media m ON m.id = j.media_id
           WHERE j.status = 'queued'
           ORDER BY j.priority DESC, m.rowid DESC, j.id DESC
           LIMIT 1`,
        )
        .get() as { id: number; media_id: string; kind: Job['kind']; attempts: number } | undefined
      if (!row) return undefined

      this.#db
        .prepare("UPDATE index_jobs SET status = 'running', updated_ts = ? WHERE id = ?")
        .run(now, row.id)
      return { id: row.id, mediaId: row.media_id, kind: row.kind, attempts: row.attempts }
    })()
  }

  complete(jobId: number, now = 0): void {
    this.#db
      .prepare(
        "UPDATE index_jobs SET status = 'done', last_error = NULL, updated_ts = ? WHERE id = ?",
      )
      .run(now, jobId)
  }

  /**
   * Records a failure. Below the attempt limit the job goes back to the queue; at the limit it is
   * failed for good, so a file that cannot be read does not occupy the queue forever.
   */
  fail(jobId: number, error: string, now = 0): 'requeued' | 'failed' {
    const row = this.#db.prepare('SELECT attempts FROM index_jobs WHERE id = ?').get(jobId) as
      { attempts: number } | undefined
    const attempts = (row?.attempts ?? 0) + 1
    const status = attempts >= this.#maxAttempts ? 'failed' : 'queued'
    this.#db
      .prepare(
        'UPDATE index_jobs SET attempts = ?, status = ?, last_error = ?, updated_ts = ? WHERE id = ?',
      )
      .run(attempts, status, error.slice(0, 1000), now, jobId)
    return status === 'failed' ? 'failed' : 'requeued'
  }

  /** Backoff in milliseconds before a requeued job should be attempted again. */
  static backoffMs(attempts: number, baseMs = 5000): number {
    return Math.min(baseMs * 2 ** Math.max(0, attempts - 1), 10 * 60_000)
  }

  /**
   * Puts jobs of one source back in the queue — "re-index with the newer model", which must not
   * disturb the other sources of the same media (§5.4).
   */
  reindex(kind: Job['kind'], now = 0): number {
    const info = this.#db
      .prepare(
        `UPDATE index_jobs SET status = 'queued', attempts = 0, last_error = NULL, updated_ts = ?
         WHERE kind = ? AND status IN ('done', 'failed')`,
      )
      .run(now, kind)
    return info.changes
  }

  /** Anything left "running" by a crash belongs back in the queue. */
  recoverStale(now = 0): number {
    return this.#db
      .prepare("UPDATE index_jobs SET status = 'queued', updated_ts = ? WHERE status = 'running'")
      .run(now).changes
  }

  counts(): QueueCounts {
    const rows = this.#db
      .prepare('SELECT status, count(*) AS n FROM index_jobs GROUP BY status')
      .all() as { status: keyof QueueCounts; n: number }[]
    const counts: QueueCounts = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 }
    for (const r of rows) counts[r.status] = r.n
    return counts
  }
}
