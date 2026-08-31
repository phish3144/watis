import { decideFetch, type FetchRules, type MediaCandidate } from './media-pipeline'
import type { BridgeHost } from '../bridge/host'
import { log } from '../logging'

/**
 * Fetches the attachments the rules say to fetch, and puts them in the blob store (PLAN.md Phase 3).
 *
 * It works the `pending` rows rather than reacting to events. A row survives a quit; a callback
 * does not — so a download interrupted halfway is picked up on the next pass instead of being lost
 * with no trace that it was ever wanted.
 *
 * Pacing matters as much as the rules. This runs at the speed of somebody opening files, not at
 * the speed of a loop: the requests go through WhatsApp's own downloader against WhatsApp's own
 * servers, and a burst is both rude and conspicuous.
 */

const PASS_INTERVAL_MS = 20_000
const BATCH = 5
const BETWEEN_FILES_MS = 750

export interface MediaFetcherOptions {
  bridge: BridgeHost
  archive: (request: unknown) => Promise<unknown>
  rules?: FetchRules | undefined
  /** Overridable so tests do not have to sit through the pacing. */
  betweenFilesMs?: number | undefined
}

export interface MediaFetcherStats {
  fetched: number
  skipped: number
  failed: number
  lastReason?: string | undefined
}

export class MediaFetcher {
  readonly #options: MediaFetcherOptions
  readonly #stats: MediaFetcherStats = { fetched: 0, skipped: 0, failed: 0 }
  #timer: NodeJS.Timeout | undefined
  #running = false

  constructor(options: MediaFetcherOptions) {
    this.#options = options
  }

  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.pass(), PASS_INTERVAL_MS)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  stats(): MediaFetcherStats {
    return { ...this.#stats }
  }

  /** One pass over the pending rows. Overlapping passes are skipped rather than queued. */
  async pass(): Promise<void> {
    if (this.#running || !this.#options.bridge.ready) return
    this.#running = true
    try {
      const result = (await this.#options.archive({ op: 'pendingMedia', limit: BATCH })) as {
        media?: MediaCandidate[]
      }
      for (const candidate of result.media ?? []) {
        await this.#one(candidate)
        await delay(this.#options.betweenFilesMs ?? BETWEEN_FILES_MS)
      }
    } catch (error: unknown) {
      log.warn(`media pass failed: ${String(error)}`)
    } finally {
      this.#running = false
    }
  }

  /**
   * Fetches one attachment on request, regardless of the automatic rules — this is the "videos on
   * click" path from §10, and a click is the user saying they want this particular file.
   */
  async fetchNow(candidate: MediaCandidate): Promise<boolean> {
    return this.#one(candidate, true)
  }

  async #one(candidate: MediaCandidate, manual = false): Promise<boolean> {
    const decision = decideFetch(candidate, this.#options.rules, manual)
    if (!decision.fetch) {
      // Every refusal names its reason and is recorded on the row, not just logged: a file that is
      // silently absent looks like a bug in the archive.
      this.#stats.skipped++
      this.#stats.lastReason = decision.reason
      await this.#mark(candidate.id, 'skipped')
      return false
    }

    if (!candidate.msgId) {
      this.#stats.skipped++
      this.#stats.lastReason = 'no message to download from'
      await this.#mark(candidate.id, 'skipped')
      return false
    }

    try {
      const media = (await this.#options.bridge.send('downloadMedia', {
        msgId: candidate.msgId,
      })) as { data?: string; mime?: string; filename?: string } | undefined

      if (!media?.data) {
        // The module is not there or gave nothing back. Skipped rather than failed: retrying a
        // missing downloader three times per file just burns the queue.
        this.#stats.skipped++
        this.#stats.lastReason = 'WhatsApp did not hand over the file'
        await this.#mark(candidate.id, 'skipped')
        return false
      }

      const stored = (await this.#options.archive({
        op: 'storeBlob',
        mediaId: candidate.id,
        data: media.data,
        mime: media.mime ?? candidate.mime ?? null,
        filename: media.filename ?? candidate.filename ?? null,
      })) as { stored?: boolean; reason?: string }

      if (stored.stored) {
        this.#stats.fetched++
        return true
      }
      this.#stats.skipped++
      this.#stats.lastReason = stored.reason
      return false
    } catch (error: unknown) {
      this.#stats.failed++
      this.#stats.lastReason = String(error)
      await this.#mark(candidate.id, 'failed')
      return false
    }
  }

  async #mark(mediaId: string, status: 'failed' | 'skipped'): Promise<void> {
    try {
      await this.#options.archive({ op: 'markMedia', mediaId, status })
    } catch (error: unknown) {
      log.warn(`could not record media status: ${String(error)}`)
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.()
  })
}
