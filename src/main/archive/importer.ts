import { MAX_BATCH } from '@shared/ipc/archive-protocol'
import { RingBuffer } from '@shared/ipc/ring-buffer'
import type { MirrorRow } from '@shared/model/rows'

/**
 * The spine between the bridge and the archive worker (PLAN.md §3.1).
 *
 * The bridge produces events one at a time — a busy group can emit hundreds a second. One IPC round
 * trip each would drown both processes, so events land in a bounded ring buffer and leave in batches
 * on a timer. The buffer drops rather than grows: a stalled worker must cost a countable gap, not
 * an out-of-memory crash.
 */

export type ImportEvent = MirrorRow

export interface ImporterOptions {
  /** How often to drain. §3.1 asks for roughly a quarter second. */
  flushIntervalMs?: number
  /** Ring size. Two flushes' worth of a very busy chat. */
  capacity?: number
  batchSize?: number
}

export interface ImporterStats {
  queued: number
  dropped: number
  written: number
  failedBatches: number
  lastError?: string | undefined
}

type Send = (request: unknown) => Promise<unknown>

export class Importer {
  readonly #buffer: RingBuffer<ImportEvent>
  readonly #send: Send
  readonly #batchSize: number
  readonly #flushIntervalMs: number
  #timer: NodeJS.Timeout | undefined
  #written = 0
  #failedBatches = 0
  #lastError: string | undefined
  #flushing = false

  constructor(send: Send, options: ImporterOptions = {}) {
    this.#send = send
    this.#batchSize = Math.min(options.batchSize ?? MAX_BATCH, MAX_BATCH)
    this.#flushIntervalMs = options.flushIntervalMs ?? 250
    this.#buffer = new RingBuffer<ImportEvent>(options.capacity ?? 5000)
  }

  push(event: ImportEvent): void {
    this.#buffer.push(event)
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.flush(), this.#flushIntervalMs)
    this.#timer.unref?.()
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
    // Drain what is left, so shutting down does not throw away a partial batch.
    while (this.#buffer.size > 0) {
      const before = this.#buffer.size
      await this.flush()
      if (this.#buffer.size >= before) break // not draining; stop rather than spin
    }
  }

  /**
   * Drains one batch. Overlapping flushes are skipped rather than queued: the timer fires on a
   * schedule, but a slow write must not stack round trips on top of each other.
   */
  async flush(): Promise<void> {
    if (this.#flushing || this.#buffer.size === 0) return
    this.#flushing = true
    try {
      const events = this.#buffer.drain(this.#batchSize)
      if (events.length === 0) return

      // flatMap on the discriminant rather than filter+cast: each array comes out with the row
      // type that goes with its kind, and a new kind would not compile until it is handled here.
      const request = {
        op: 'import' as const,
        chats: events.flatMap((e) => (e.kind === 'chat' ? [e.row] : [])),
        contacts: events.flatMap((e) => (e.kind === 'contact' ? [e.row] : [])),
        messages: events.flatMap((e) => (e.kind === 'message' ? [e.row] : [])),
        media: events.flatMap((e) => (e.kind === 'media' ? [e.row] : [])),
      }

      try {
        const result = (await this.#send(request)) as { written?: number } | undefined
        this.#written += result?.written ?? 0
        this.#lastError = undefined
      } catch (error) {
        // The batch is gone either way — putting it back would mean re-ordering it behind newer
        // events, and the bridge can re-emit on the next sync. What must not happen is silence.
        this.#failedBatches++
        this.#lastError = String(error)
      }
    } finally {
      this.#flushing = false
    }
  }

  stats(): ImporterStats {
    return {
      queued: this.#buffer.size,
      dropped: this.#buffer.dropped,
      written: this.#written,
      failedBatches: this.#failedBatches,
      lastError: this.#lastError,
    }
  }
}
