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
  /** Ring size. Large enough for a whole initial snapshot, not just a busy minute. */
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
    // 50 000 rather than 5000. The ring is the shock absorber for exactly one event — the initial
    // snapshot — and on a real account that was 8294 messages in one go. Sized to swallow a large
    // one whole while the drain above keeps up, at roughly a megabyte of rows.
    this.#buffer = new RingBuffer<ImportEvent>(options.capacity ?? 50_000)
  }

  push(event: ImportEvent): void {
    this.#buffer.push(event)
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.drain(), this.#flushIntervalMs)
    this.#timer.unref?.()
  }

  /**
   * Empties the buffer, rather than taking one batch off it and waiting a quarter second.
   *
   * The timer used to call flush() directly, which capped the whole pipeline at one batch per tick
   * — 500 rows per 250 ms, about 2000 a second. An initial snapshot hands over everything WhatsApp
   * has in memory at once: measured on a real account, 8294 messages arriving against a 5000-slot
   * ring. The buffer did what it is designed to do and dropped the excess, and 2691 messages were
   * simply gone. A quarter-second of batching is right for a trickle and wrong for a flood.
   *
   * Each round trip is awaited, so the main process is never blocked; it just stops idling between
   * batches while there is work. The bound stops a producer that outruns us forever from turning
   * this into an unbounded loop — the next tick picks up whatever is left.
   */
  async drain(maxBatches = 40): Promise<void> {
    for (let i = 0; i < maxBatches && this.#buffer.size > 0; i++) {
      const before = this.#buffer.size
      await this.flush()
      // flush() returns early while another drain is in flight; stopping avoids a busy loop.
      if (this.#buffer.size >= before) return
    }
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
    // Drain what is left, so shutting down does not throw away a partial batch.
    while (this.#buffer.size > 0) {
      const before = this.#buffer.size
      await this.drain()
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
