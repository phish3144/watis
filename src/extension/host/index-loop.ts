import { IndexQueue } from '../../workers/content-index/queue'
import { IndexRunner } from '../../workers/content-index/runner'
import type { Engine } from '../../workers/content-index/engine'
import type { SqlDatabase } from '../../workers/archive/sql'
import { OpfsBlobStore } from './opfs-blobs'
import { browserEngines } from './engines'

/**
 * The content index in the browser: the desktop's queue and runner, unchanged, fed by engines that
 * read their input from OPFS instead of from a disk path (PLAN.md Phase 7, ADR 0010).
 *
 * The runner hands an engine "a file" as a string. On the desktop that is an absolute path; here it
 * is the blob's OPFS path, and the browser engines open it themselves — so the queue, the
 * priorities, the retries and the storage of results are the same code in both shells.
 *
 * It runs in the archive worker, beside the database it writes to, one job at a time with a pause
 * in between. Transcription is not part of the loop: it is on demand (ADR 0001 §4) and started from
 * the panel for one voice message at a time.
 */

const IDLE_PASS_MS = 15_000
const BETWEEN_JOBS_MS = 250
const JOBS_PER_PASS = 20

export class IndexLoop {
  readonly #db: SqlDatabase
  readonly #runner: IndexRunner
  readonly #log: (level: 'info' | 'warn', message: string) => void
  #timer: ReturnType<typeof setTimeout> | undefined
  #running = false
  #paused = false

  constructor(db: SqlDatabase, log: (level: 'info' | 'warn', message: string) => void) {
    this.#db = db
    this.#log = log
    const engines: Partial<Record<string, Engine>> = browserEngines()
    this.#runner = new IndexRunner({
      db,
      queue: new IndexQueue(db),
      engines,
      fileFor: (mediaId) => Promise.resolve(this.#fileFor(mediaId)),
      now: () => Math.floor(Date.now() / 1000),
      log: (level, message) => {
        this.#log(level === 'error' ? 'warn' : level, message)
      },
    })
  }

  start(): void {
    this.#schedule(2_000)
  }

  setPaused(paused: boolean): void {
    this.#paused = paused
    if (paused) this.#runner.stop()
    else this.wake()
  }

  /** A new blob arrived; look sooner than the idle pass would. */
  wake(): void {
    this.#schedule(1_000)
  }

  #schedule(ms: number): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.#pass()
    }, ms)
  }

  async #pass(): Promise<void> {
    if (this.#running) return
    this.#running = true
    try {
      if (!this.#paused) {
        this.#runner.enqueuePending(500)
        for (let i = 0; i < JOBS_PER_PASS && !this.#paused; i++) {
          const outcome = await this.#runner.run(1)
          if (outcome.processed === 0) break
          // A pause between jobs keeps the worker answering searches while a backlog runs.
          await new Promise((resolve) => setTimeout(resolve, BETWEEN_JOBS_MS))
        }
      }
    } catch (error) {
      this.#log('warn', `index pass failed: ${String(error)}`)
    } finally {
      this.#running = false
      this.#schedule(IDLE_PASS_MS)
    }
  }

  #fileFor(mediaId: string): { path: string; mime: string } | undefined {
    const row = this.#db
      .prepare('SELECT sha256, mime, filename FROM media WHERE id = ?')
      .get(mediaId) as
      { sha256: string | null; mime: string | null; filename: string | null } | undefined
    if (!row?.sha256) return undefined
    return {
      path: OpfsBlobStore.pathFor(row.sha256, row.mime, row.filename),
      mime: row.mime ?? 'application/octet-stream',
    }
  }
}
