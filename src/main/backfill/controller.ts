import { powerMonitor } from 'electron'
import { BackfillMachine, type BackfillSnapshot, type Effects } from './state-machine'
import type { BridgeHost } from '../bridge/host'
import { log } from '../logging'

/**
 * Wires the backfill machine to the real bridge and the real archive (PLAN.md Phase 5).
 *
 * The machine itself knows nothing about either — it talks to `Effects`, which is what lets the
 * error and resume paths be tested against fakes. This file is the only place those effects are
 * the actual ones.
 *
 * The run is started by the user and by nobody else (ADR 0006): loading a chat's older messages
 * means opening it, opening it marks it read, and a background sweep would therefore mark chats
 * read that nobody wanted to see.
 */

/** Between batches. Slow enough to look like a person scrolling, which is what it is standing in for. */
const BATCH_DELAY_MS = 1500

export interface BackfillControllerOptions {
  bridge: BridgeHost
  /** Sends a request to the archive worker. */
  archive: (request: unknown) => Promise<unknown>
  onChange?: ((snapshot: BackfillSnapshot) => void) | undefined
  /** Overridable so tests do not have to sit through the human pacing. */
  batchDelayMs?: number | undefined
}

export class BackfillController {
  readonly #options: BackfillControllerOptions
  readonly #machine: BackfillMachine
  #depthLimitTs: number | undefined

  constructor(options: BackfillControllerOptions) {
    this.#options = options
    this.#machine = new BackfillMachine(this.#effects(), {
      batchDelayMs: options.batchDelayMs ?? BATCH_DELAY_MS,
    })
  }

  #effects(): Effects {
    return {
      earliestReachableTs: async () => {
        const value = await this.#options.bridge.send('earliestReachableTs')
        this.#depthLimitTs = typeof value === 'number' ? value : undefined
        return this.#depthLimitTs
      },

      loadOlder: async (chatId) => {
        const result = (await this.#options.bridge.send('loadOlder', { chatId })) as {
          loaded?: number
          oldestTs?: number
          atFloor?: boolean
        }
        return {
          loaded: result?.loaded ?? 0,
          oldestTs: result?.oldestTs,
          atFloor: result?.atFloor ?? false,
        }
      },

      wait: (ms) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, ms).unref?.()
        }),

      // The machine asks before every batch. Both conditions here mean the same thing to it —
      // not now — but they are different situations: a bridge that is gone is a fault, and a
      // machine the user is sitting in front of is just bad timing.
      canRun: () => Promise.resolve(this.#options.bridge.ready && !isUserBusy()),

      persist: (snapshot) => this.#persist(snapshot),

      onChange: (snapshot) => {
        this.#options.onChange?.(snapshot)
      },
    }
  }

  /**
   * Writes progress per chat, so a run interrupted by a quit resumes from the timestamp it reached.
   * `depth_limit_ts` is stored alongside, which is what makes "as far back as WhatsApp goes"
   * checkable later rather than a claim.
   */
  async #persist(snapshot: BackfillSnapshot): Promise<void> {
    const rows = snapshot.chats
      .filter((c) => c.state !== 'queued')
      .map((c) => ({
        chatId: c.chatId,
        oldestTs: c.oldestTs ?? null,
        backfillDone: c.state === 'done',
        depthLimitTs: snapshot.reachableTs ?? this.#depthLimitTs ?? null,
        lastError: c.lastError ?? null,
      }))
    if (rows.length === 0) return
    try {
      await this.#options.archive({ op: 'saveSyncState', rows })
    } catch (error: unknown) {
      // Losing the bookkeeping costs a resume point, not the messages — those went in through the
      // importer. Worth a log line, not worth stopping the run.
      log.warn(`backfill progress not saved: ${String(error)}`)
    }
  }

  /** Restores the queue from what was recorded, so a restart continues rather than starts over. */
  async restore(chatIds: readonly string[]): Promise<void> {
    let done = new Set<string>()
    try {
      const result = (await this.#options.archive({ op: 'syncState' })) as {
        rows?: { chatId: string; backfillDone?: boolean }[]
      }
      done = new Set((result.rows ?? []).filter((r) => r.backfillDone).map((r) => r.chatId))
    } catch (error: unknown) {
      log.warn(`could not read backfill progress: ${String(error)}`)
    }
    this.#machine.enqueue(chatIds.filter((id) => !done.has(id)))
  }

  enqueue(chatIds: readonly string[]): void {
    this.#machine.enqueue(chatIds)
  }

  prioritise(chatId: string): void {
    this.#machine.prioritise(chatId)
  }

  snapshot(): BackfillSnapshot {
    return this.#machine.snapshot()
  }

  /**
   * Why the run is standing still, in the UI's words. A progress display that just stops is the
   * thing this phase is explicitly trying not to build.
   */
  pauseReason(): 'bridge' | 'in-use' | undefined {
    if (!this.#options.bridge.ready) return 'bridge'
    if (isUserBusy()) return 'in-use'
    return undefined
  }

  start(): Promise<BackfillSnapshot> {
    if (!this.#options.bridge.ready) return Promise.reject(new Error('bridge is not available'))
    log.info('backfill started by the user')
    return this.#machine.run()
  }

  stop(): void {
    this.#machine.stop()
  }
}

/**
 * Idle detection, so the backfill gets out of the way while somebody is using the machine. It opens
 * chats and scrolls them, which is visible and disruptive if it happens under the user's hands.
 */
function isUserBusy(): boolean {
  try {
    return powerMonitor.getSystemIdleTime() < 60
  } catch {
    // Unsupported platform: assume the user is there. Getting this wrong in the other direction
    // would mean scrolling chats while they read them.
    return true
  }
}
