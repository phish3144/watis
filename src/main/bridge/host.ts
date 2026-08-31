import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, ipcMain, type WebContents } from 'electron'
import type { BridgeCommand, BridgeMessage, BridgeReady } from '../../bridge/protocol'
import type { ImportEvent } from '../archive/importer'
import { log } from '../logging'

/**
 * The main-process end of the bridge (PLAN.md Phase 3).
 *
 * It injects the bundle into WhatsApp's page after every load, receives mirrored batches, and issues
 * the handful of permitted commands. It holds no WhatsApp objects itself: everything crossing the
 * boundary is JSON, so nothing in this process can accidentally reach a live WhatsApp model and
 * call something on it.
 *
 * Injection happens on `did-finish-load` rather than once at startup because WhatsApp Web reloads
 * itself — after a logout, after an update, after losing the socket for long enough. The bundle
 * tears down its predecessor on the way in, so re-injection is idempotent.
 */

const COMMAND_TIMEOUT_MS = 30_000

export interface BridgeHostOptions {
  /** Where mirrored rows go. */
  onEvents: (events: ImportEvent[]) => void
  /** Called with each health report, so the UI can show a bridge outage. */
  onHealth: (report: BridgeReady) => void
  /** Called once the initial snapshot has been handed over. */
  onSnapshotDone?: (() => void) | undefined
}

export class BridgeHost {
  readonly #options: BridgeHostOptions
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >()
  #contents: WebContents | undefined
  #source: string | undefined
  #nextId = 1
  #ready = false

  constructor(options: BridgeHostOptions) {
    this.#options = options
  }

  /** True once the page reported a healthy bridge. Commands before that are refused, not queued. */
  get ready(): boolean {
    return this.#ready
  }

  attach(contents: WebContents): void {
    this.#contents = contents

    ipcMain.on('wa:bridge-message', (event, detail: unknown) => {
      // Only the view we attached to may speak for the bridge.
      if (event.sender !== this.#contents || typeof detail !== 'string') return
      this.#receive(detail)
    })

    contents.on('did-finish-load', () => {
      this.#ready = false
      void this.#inject()
    })
  }

  async #inject(): Promise<void> {
    const contents = this.#contents
    if (!contents || contents.isDestroyed()) return
    try {
      this.#source ??= await readFile(bridgeBundlePath(), 'utf8')
      // Runs in the page's own world, which is the only place `window.require` exists. The bundle
      // never throws out of itself, so a rejection here means the injection failed, not the bridge.
      await contents.executeJavaScript(this.#source)
    } catch (error: unknown) {
      log.warn(`bridge injection failed: ${String(error)}`)
      this.#options.onHealth({
        type: 'ready',
        ok: false,
        resolved: [],
        failures: [{ module: '(injection)', reason: 'threw', detail: String(error) }],
        attached: 0,
      })
    }
  }

  #receive(detail: string): void {
    let message: BridgeMessage
    try {
      message = JSON.parse(detail) as BridgeMessage
    } catch {
      log.warn('bridge sent a malformed message')
      return
    }

    switch (message.type) {
      case 'ready': {
        this.#ready = message.ok
        if (message.ok) log.info(`bridge ready on WA Web ${message.version ?? 'unknown'}`)
        else log.warn(`bridge unavailable: ${message.failures.map((f) => f.module).join(', ')}`)
        this.#options.onHealth(message)
        return
      }
      case 'batch': {
        if (message.events.length > 0) this.#options.onEvents(message.events)
        if (message.snapshotDone) this.#options.onSnapshotDone?.()
        return
      }
      case 'result': {
        const pending = this.#pending.get(message.id)
        if (!pending) return
        this.#pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.ok) pending.resolve(message.value)
        else pending.reject(new Error(message.error ?? 'bridge command failed'))
        return
      }
    }
  }

  /**
   * Issues one command. Rejects rather than hangs when the page never answers — a bridge that has
   * stopped responding must surface as a failure, not as a promise nobody settles.
   */
  send(op: BridgeCommand['op'], args?: Record<string, unknown>): Promise<unknown> {
    const contents = this.#contents
    if (!contents || contents.isDestroyed()) return Promise.reject(new Error('no WhatsApp view'))

    const id = this.#nextId++
    const command: BridgeCommand = args ? { id, op, args } : { id, op }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`bridge did not answer ${op}`))
      }, COMMAND_TIMEOUT_MS)
      timer.unref?.()
      this.#pending.set(id, { resolve, reject, timer })
      contents.send('wa:bridge-command', JSON.stringify(command))
    })
  }

  dispose(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('bridge shutting down'))
    }
    this.#pending.clear()
    this.#contents = undefined
  }
}

/**
 * `out/**` is what electron-builder packs, so the path is the same in dev and when packaged — and
 * inside the asar `readFile` works unchanged.
 */
export function bridgeBundlePath(): string {
  return join(app.getAppPath(), 'out', 'bridge', 'bridge.js')
}
