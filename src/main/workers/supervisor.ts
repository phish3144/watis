import { join } from 'node:path'
import { MessageChannelMain, utilityProcess } from 'electron'
import type { MessagePortMain, UtilityProcess } from 'electron'
import { parseWorkerMessage, type HostToWorker, type WorkerName } from '@shared/ipc/worker-protocol'
import { appPaths } from '../paths'
import { log } from '../logging'

/**
 * Archive (SQLite) and content index (OCR, PDF, transcription) run as their own Node processes.
 * The main process coordinates and never holds a Database handle: better-sqlite3 is synchronous
 * and compiled with SQLITE_OMIT_PROGRESS_CALLBACK, so a long query blocks whichever process
 * opened the database with no way to interrupt it. A measured 500-row batch commit is ~68ms,
 * four times the 16ms budget for main.
 *
 * Communication is over a MessagePortMain pair rather than the default parentPort, so the port
 * can later be handed to the renderer directly and keep main out of the hot path entirely.
 */

const PING_INTERVAL_MS = 10_000
const PING_TIMEOUT_MS = 5_000
const RESTART_BASE_DELAY_MS = 500
const RESTART_MAX_DELAY_MS = 30_000

interface Supervised {
  name: WorkerName
  entry: string
  process?: UtilityProcess
  port?: MessagePortMain
  ready: boolean
  restarts: number
  pendingPing?: { nonce: number; timer: NodeJS.Timeout }
  pingTimer?: NodeJS.Timeout
  stopping: boolean
}

const WORKER_ENTRIES: Record<WorkerName, string> = {
  archive: 'archive.js',
  contentIndex: 'contentIndex.js',
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class WorkerSupervisor {
  private requestId = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly workers = new Map<WorkerName, Supervised>()
  private nonce = 0

  start(name: WorkerName): void {
    let state = this.workers.get(name)
    if (!state) {
      state = {
        name,
        entry: join(__dirname, WORKER_ENTRIES[name]),
        ready: false,
        restarts: 0,
        stopping: false,
      }
      this.workers.set(name, state)
    }
    this.spawn(state)
  }

  private spawn(state: Supervised): void {
    const { port1, port2 } = new MessageChannelMain()
    const child = utilityProcess.fork(state.entry, [], {
      serviceName: `watis-${state.name}`,
      stdio: 'pipe',
      env: {
        ...process.env,
        WATIS_WORKER: state.name,
        WATIS_ARCHIVE_DIR: appPaths().archive,
        WATIS_BLOBS_DIR: appPaths().blobs,
        WATIS_MODELS_DIR: appPaths().models,
      },
    })

    state.process = child
    state.port = port1
    state.ready = false

    child.postMessage({ type: 'port' }, [port2])

    port1.on('message', (event) => {
      const message = parseWorkerMessage(event.data)
      if (!message) {
        log.warn(`${state.name}: dropped malformed message`)
        return
      }
      switch (message.type) {
        case 'ready':
          state.ready = true
          state.restarts = 0
          log.info(`${state.name} worker ready (pid ${message.pid})`)
          break
        case 'pong':
          if (state.pendingPing?.nonce === message.nonce) {
            clearTimeout(state.pendingPing.timer)
            delete state.pendingPing
          }
          break
        case 'log':
          log[message.level](`${state.name}: ${message.message}`)
          break
        case 'fatal':
          log.error(`${state.name} reported fatal: ${message.message}`)
          break
        case 'response': {
          const pending = this.pending.get(message.id)
          if (!pending) break // already timed out; its caller has been told
          this.pending.delete(message.id)
          clearTimeout(pending.timer)
          if (message.ok) pending.resolve(message.result)
          else pending.reject(new Error(message.error ?? 'worker request failed'))
          break
        }
      }
    })
    port1.start()

    child.stderr?.on('data', (chunk: Buffer) => {
      log.error(`${state.name} stderr: ${chunk.toString().trimEnd()}`)
    })

    child.on('exit', (code) => {
      state.ready = false
      this.clearTimers(state)
      if (state.stopping) {
        log.info(`${state.name} worker stopped`)
        return
      }
      const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** state.restarts, RESTART_MAX_DELAY_MS)
      state.restarts += 1
      this.rejectPending(`${state.name} worker exited before answering`)
      log.warn(`${state.name} worker exited (code ${code}); restarting in ${delay}ms`)
      setTimeout(() => {
        if (!state.stopping) this.spawn(state)
      }, delay).unref()
    })

    this.startHealthPings(state)
  }

  private startHealthPings(state: Supervised): void {
    state.pingTimer = setInterval(() => {
      if (!state.ready || !state.port) return
      if (state.pendingPing) return // previous ping still outstanding; its timeout will fire
      const nonce = ++this.nonce
      const timer = setTimeout(() => {
        log.error(`${state.name} worker missed health ping; killing it`)
        state.process?.kill()
      }, PING_TIMEOUT_MS)
      timer.unref()
      state.pendingPing = { nonce, timer }
      this.send(state.name, { type: 'ping', nonce })
    }, PING_INTERVAL_MS)
    state.pingTimer.unref()
  }

  private clearTimers(state: Supervised): void {
    if (state.pingTimer) clearInterval(state.pingTimer)
    if (state.pendingPing) clearTimeout(state.pendingPing.timer)
    delete state.pingTimer
    delete state.pendingPing
  }

  send(name: WorkerName, message: HostToWorker): void {
    this.workers.get(name)?.port?.postMessage(message)
  }

  /**
   * One data-plane round trip. Rejects rather than hanging when the worker is not there or does not
   * answer — a renderer waiting forever on a dead worker looks exactly like a frozen application.
   */
  request(name: WorkerName, payload: unknown, timeoutMs = 30_000): Promise<unknown> {
    const state = this.workers.get(name)
    if (!state?.ready || !state.port) {
      return Promise.reject(new Error(`${name} worker is not ready`))
    }

    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${name} worker did not answer within ${String(timeoutMs)} ms`))
      }, timeoutMs)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      state.port?.postMessage({ type: 'request', id, payload })
    })
  }

  /** Fails every outstanding request, so a worker crash surfaces instead of hanging its callers. */
  private rejectPending(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(reason))
    }
    this.pending.clear()
  }

  isReady(name: WorkerName): boolean {
    return this.workers.get(name)?.ready ?? false
  }

  /**
   * Orderly shutdown. This matters more than it looks: the NSIS updater kills watis.exe by name
   * only, so a surviving worker still holding the SQLite WAL produces the RETRY/CANCEL
   * "application cannot be closed" dialog and a failed update.
   */
  async stopAll(reason: string, timeoutMs = 4000): Promise<void> {
    const exits = [...this.workers.values()].map(async (state) => {
      state.stopping = true
      this.clearTimers(state)
      if (!state.process) return
      const child = state.process
      this.send(state.name, { type: 'shutdown', reason })
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          log.warn(`${state.name} worker did not exit in time; killing`)
          child.kill()
          resolve()
        }, timeoutMs)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    })
    await Promise.all(exits)
  }
}
