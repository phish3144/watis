import { parseSettings, type Settings } from '@shared/settings'
import type { BridgeCommand } from '../../bridge/protocol'
import type { FetchRules, MediaCandidate } from '../../main/archive/fetch-rules'
import { MediaFetcher, type MediaFetcherStats } from '../../main/archive/media-fetcher'
import { ext } from '../ext'
import { SETTINGS_KEY, type HostStatus, type Reply } from '../protocol'
import type { FromWorker, ToWorker } from './worker-protocol'

/**
 * The context that holds the archive (ADR 0010).
 *
 * It runs in two places: framed invisibly into the WhatsApp tab, and in the panel when no tab is
 * open. Both start the same worker; the worker's OPFS pool can be open in only one of them, and
 * that one is the archive. The other stands by and tries again every few seconds — the frame
 * keeps trying, the panel steps back as soon as a WhatsApp tab exists — so the archive lives with
 * the tab whenever there is one, and searching still works when there is not.
 *
 * It knows nothing about how requests reach it. The frame wires it to its relay over a private
 * port (`frame-link.ts`); the panel calls it directly. That is what lets the same class run in
 * Firefox's restricted frame, which has almost no extension APIs, and in a full extension page.
 * The only extension API it touches is `storage.local`, for the settings, which both have.
 */

const RETRY_BUSY_MS = 3_000
const RETRY_FAILED_MS = 30_000
const REQUEST_TIMEOUT_MS = 60_000

export function fetchRulesFrom(settings: Settings): FetchRules {
  return {
    images: settings.archiveImages,
    documents: settings.archiveDocuments,
    audio: settings.archiveVoice,
    videoAutoMaxBytes: settings.archiveVideoMaxMb * 1024 * 1024,
  }
}

export type HostReport =
  { kind: 'status'; status: HostStatus } | { kind: 'media'; stats: MediaFetcherStats }

export interface HostDeps {
  where: HostStatus['where']
  /** Runs one read-only bridge command in the WhatsApp tab; absent where there is no bridge. */
  bridge?:
    ((op: BridgeCommand['op'], args?: Record<string, unknown>) => Promise<unknown>) | undefined
  report: (report: HostReport) => void
}

export class ArchiveHost {
  readonly #deps: HostDeps
  readonly #pending = new Map<number, (reply: Reply) => void>()
  #worker: Worker | undefined
  #owner = false
  #stopped = false
  #retry: ReturnType<typeof setTimeout> | undefined
  #nextId = 1
  #settings: Settings = parseSettings(undefined)
  #bridgeOk = false
  #fetcher: MediaFetcher | undefined
  #mediaTimer: ReturnType<typeof setInterval> | undefined

  constructor(deps: HostDeps) {
    this.#deps = deps
  }

  get owner(): boolean {
    return this.#owner
  }

  async start(): Promise<void> {
    this.#stopped = false
    const stored = await ext.storage.local.get(SETTINGS_KEY)
    this.#settings = parseSettings(stored[SETTINGS_KEY])
    ext.storage.onChanged.addListener(this.#onStorage)
    this.#open()
  }

  /** Gives the archive up, so another context can take it. */
  stop(): void {
    this.#stopped = true
    ext.storage.onChanged.removeListener(this.#onStorage)
    if (this.#retry !== undefined) clearTimeout(this.#retry)
    this.#release()
  }

  setBridgeReady(ok: boolean): void {
    this.#bridgeOk = ok
    if (ok) void this.#fetcher?.pass()
  }

  /** Runs one archive request in the worker. */
  request(payload: unknown): Promise<Reply> {
    if (!this.#worker || !this.#owner)
      return Promise.resolve({ ok: false, error: 'not the archive' })
    const reply = this.#ask((id) => ({ type: 'request', id, payload }))
    // New attachments are fetched promptly rather than on the next timed pass: WhatsApp keeps
    // media on its servers for a limited time, and soon after arrival is when a fetch is surest
    // to succeed (ADR 0011).
    const request = payload as { op?: unknown; media?: unknown[] } | null
    if (request?.op === 'import' && request.media?.length) {
      void reply.then(() => this.#fetcher?.pass())
    }
    return reply
  }

  /** Fetches one attachment now, past the automatic rules — "videos on click" (ADR 0001 §3). */
  async fetchMedia(mediaId: string): Promise<Reply> {
    const found = await this.request({ op: 'media', mediaId })
    if (!found.ok) return found
    const candidate = (found.value as { media: MediaCandidate | null }).media
    if (!candidate) return { ok: false, error: 'unknown attachment' }
    if (!this.#fetcher) return { ok: false, error: 'media fetching is not running' }
    const fetched = await this.#fetcher.fetchNow(candidate)
    return fetched
      ? { ok: true, value: true }
      : { ok: false, error: this.#fetcher.stats().lastReason ?? 'not fetched' }
  }

  /**
   * Copies the database to a file in OPFS and answers with its path. The panel, which shares the
   * OPFS, turns that file into an ordinary download — the frame could not: in Firefox it has no
   * downloads API.
   */
  exportDatabase(): Promise<Reply> {
    if (!this.#worker || !this.#owner)
      return Promise.resolve({ ok: false, error: 'not the archive' })
    return this.#ask((id) => ({ type: 'export', id }))
  }

  /** Replaces the archive with the database at this OPFS path, a restored backup (restore.ts). */
  importDatabase(path: string): Promise<Reply> {
    if (!this.#worker || !this.#owner)
      return Promise.resolve({ ok: false, error: 'not the archive' })
    return this.#ask((id) => ({ type: 'import', id, path }))
  }

  // --- ownership --------------------------------------------------------------------------------

  #open(): void {
    if (this.#stopped) return
    const worker = new Worker(new URL('./archive-worker.ts', import.meta.url), { type: 'module' })
    this.#worker = worker
    worker.onmessage = (event: MessageEvent<FromWorker>) => {
      this.#onWorker(event.data)
    }
    worker.onerror = (event) => {
      this.#report(`archive worker failed: ${event.message}`)
      this.#retryIn(RETRY_FAILED_MS)
    }
    this.#post({ type: 'open', quotaBytes: this.#settings.blobQuotaGb * 1024 ** 3 })
  }

  #release(): void {
    this.#owner = false
    this.#worker?.terminate()
    this.#worker = undefined
    this.#fetcher?.stop()
    this.#fetcher = undefined
    if (this.#mediaTimer !== undefined) clearInterval(this.#mediaTimer)
    for (const settle of this.#pending.values()) settle({ ok: false, error: 'the archive moved' })
    this.#pending.clear()
  }

  #retryIn(ms: number): void {
    this.#release()
    if (this.#stopped) return
    this.#retry = setTimeout(() => {
      this.#open()
    }, ms)
  }

  #onWorker(message: FromWorker): void {
    switch (message.type) {
      case 'opened':
        if (message.ok) {
          this.#owner = true
          this.#post({ type: 'configure', indexPaused: this.#settings.indexPaused })
          this.#report()
          this.#startFetcher()
        } else if (message.busy) {
          this.#retryIn(RETRY_BUSY_MS)
        } else {
          this.#report(message.error)
          this.#retryIn(RETRY_FAILED_MS)
        }
        return
      case 'reply':
        this.#pending.get(message.id)?.(message.reply)
        this.#pending.delete(message.id)
        return
      case 'log':
        if (message.level === 'warn') console.warn(`[watis] ${message.message}`)
        return
    }
  }

  #ask(build: (id: number) => ToWorker): Promise<Reply> {
    const id = this.#nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        resolve({ ok: false, error: 'the archive did not answer' })
      }, REQUEST_TIMEOUT_MS)
      this.#pending.set(id, (reply) => {
        clearTimeout(timer)
        resolve(reply)
      })
      this.#post(build(id))
    })
  }

  #post(message: ToWorker): void {
    this.#worker?.postMessage(message)
  }

  #report(error?: string): void {
    if (!this.#owner && !error) return
    this.#deps.report({
      kind: 'status',
      status: { where: this.#deps.where, at: Date.now(), error },
    })
  }

  readonly #onStorage = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    const change = changes[SETTINGS_KEY]
    if (area !== 'local' || !change) return
    this.#settings = parseSettings(change.newValue)
    this.#post({
      type: 'configure',
      quotaBytes: this.#settings.blobQuotaGb * 1024 ** 3,
      indexPaused: this.#settings.indexPaused,
    })
    if (this.#fetcher) {
      this.#fetcher.stop()
      this.#startFetcher()
    }
  }

  // --- media ------------------------------------------------------------------------------------

  #startFetcher(): void {
    const send = this.#deps.bridge
    if (!send) return
    const archive = async (payload: unknown): Promise<unknown> => {
      const reply = await this.request(payload)
      if (!reply.ok) throw new Error(reply.error)
      return reply.value
    }
    const isReady = (): boolean => this.#bridgeOk
    this.#fetcher = new MediaFetcher({
      bridge: {
        get ready(): boolean {
          return isReady()
        },
        send,
      },
      archive,
      rules: fetchRulesFrom(this.#settings),
      warn: (message) => {
        console.warn(`[watis] ${message}`)
      },
    })
    this.#fetcher.start()
    void this.#fetcher.pass()
    if (this.#mediaTimer !== undefined) clearInterval(this.#mediaTimer)
    this.#mediaTimer = setInterval(() => {
      if (this.#fetcher) this.#deps.report({ kind: 'media', stats: this.#fetcher.stats() })
    }, 5_000)
  }
}
