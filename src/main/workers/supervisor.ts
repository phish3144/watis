import { join } from 'node:path'
import { MessageChannelMain, utilityProcess } from 'electron'
import type { MessagePortMain, UtilityProcess } from 'electron'
import { parseWorkerMessage, type HostToWorker, type WorkerName } from '@shared/ipc/worker-protocol'
import { accountPaths, appPaths } from '../paths'
import { PRIMARY_ACCOUNT_ID } from '@shared/accounts'
import { resourcePath } from '../resources'
import { settings } from '../config/store'
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

/** One worker of one kind, for one account. The pair is what identifies it (PLAN.md Phase 8). */
interface Supervised {
  name: WorkerName
  accountId: string
  /** `${name}@${accountId}`; what the map is keyed on and what appears in the log. */
  key: string
  entry: string
  process?: UtilityProcess
  port?: MessagePortMain
  ready: boolean
  restarts: number
  pendingPing?: { nonce: number; timer: NodeJS.Timeout }
  pingTimer?: NodeJS.Timeout
  stopping: boolean
}

const workerKey = (name: WorkerName, accountId: string): string => `${name}@${accountId}`

function blobsDirFor(accountId: string): string {
  const configured = settings().blobDir.trim()
  return accountId === PRIMARY_ACCOUNT_ID && configured !== ''
    ? configured
    : accountPaths(accountId).blobs
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
  private readonly workers = new Map<string, Supervised>()
  private nonce = 0

  /**
   * Accounts each get their own worker pair, because they each get their own database file. One
   * worker serving several archives would mean a filter deciding which messages somebody sees, and
   * a filter is a thing that can be got wrong once and show the wrong person's chat.
   */
  start(name: WorkerName, accountId: string = PRIMARY_ACCOUNT_ID): void {
    const key = workerKey(name, accountId)
    let state = this.workers.get(key)
    if (!state) {
      state = {
        name,
        accountId,
        key,
        entry: join(__dirname, WORKER_ENTRIES[name]),
        ready: false,
        restarts: 0,
        stopping: false,
      }
      this.workers.set(key, state)
    }
    this.spawn(state)
  }

  /** Stops the pair belonging to one account, leaving every other account running. */
  async stopAccount(accountId: string, reason: string): Promise<void> {
    const mine = [...this.workers.values()].filter((state) => state.accountId === accountId)
    await Promise.all(mine.map((state) => this.stopOne(state, reason)))
    for (const state of mine) this.workers.delete(state.key)
  }

  private spawn(state: Supervised): void {
    const { port1, port2 } = new MessageChannelMain()
    const child = utilityProcess.fork(state.entry, [], {
      serviceName: `watis-${state.name}-${state.accountId}`,
      stdio: 'pipe',
      env: {
        ...process.env,
        WATIS_WORKER: state.name,
        WATIS_ACCOUNT: state.accountId,
        WATIS_ARCHIVE_DIR: accountPaths(state.accountId).archive,
        // A configured location applies to the primary account only. Each further account keeps
        // its own directory under accounts/<id>/: one setting pointing several accounts at the
        // same folder would merge their media, which is precisely what separate stores prevent.
        WATIS_BLOBS_DIR: blobsDirFor(state.accountId),
        WATIS_BLOB_QUOTA_GB: String(settings().blobQuotaGb),
        WATIS_MODELS_DIR: appPaths().models,
        // The OCR language data ships with the application rather than living in the user's data
        // directory: it is read-only, identical for everyone, and downloading it would be traffic
        // to a host the project does not allow.
        WATIS_TESSDATA_DIR: resourcePath('tessdata'),
      },
    })

    state.process = child
    state.port = port1
    state.ready = false

    child.postMessage({ type: 'port' }, [port2])

    port1.on('message', (event) => {
      const message = parseWorkerMessage(event.data)
      if (!message) {
        log.warn(`${state.key}: dropped malformed message`)
        return
      }
      switch (message.type) {
        case 'ready':
          state.ready = true
          state.restarts = 0
          log.info(`${state.key} worker ready (pid ${message.pid})`)
          break
        case 'pong':
          if (state.pendingPing?.nonce === message.nonce) {
            clearTimeout(state.pendingPing.timer)
            delete state.pendingPing
          }
          break
        case 'log':
          log[message.level](`${state.key}: ${message.message}`)
          break
        case 'fatal':
          log.error(`${state.key} reported fatal: ${message.message}`)
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
      log.error(`${state.key} stderr: ${chunk.toString().trimEnd()}`)
    })

    child.on('exit', (code) => {
      state.ready = false
      this.clearTimers(state)
      if (state.stopping) {
        log.info(`${state.key} worker stopped`)
        return
      }
      const delay = Math.min(RESTART_BASE_DELAY_MS * 2 ** state.restarts, RESTART_MAX_DELAY_MS)
      state.restarts += 1
      this.rejectPending(`${state.key} worker exited before answering`)
      log.warn(`${state.key} worker exited (code ${code}); restarting in ${delay}ms`)
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
        log.error(`${state.key} worker missed health ping; killing it`)
        state.process?.kill()
      }, PING_TIMEOUT_MS)
      timer.unref()
      state.pendingPing = { nonce, timer }
      state.port?.postMessage({ type: 'ping', nonce })
    }, PING_INTERVAL_MS)
    state.pingTimer.unref()
  }

  private clearTimers(state: Supervised): void {
    if (state.pingTimer) clearInterval(state.pingTimer)
    if (state.pendingPing) clearTimeout(state.pendingPing.timer)
    delete state.pingTimer
    delete state.pendingPing
  }

  send(name: WorkerName, message: HostToWorker, accountId: string = PRIMARY_ACCOUNT_ID): void {
    this.workers.get(workerKey(name, accountId))?.port?.postMessage(message)
  }

  /**
   * One data-plane round trip. Rejects rather than hanging when the worker is not there or does not
   * answer — a renderer waiting forever on a dead worker looks exactly like a frozen application.
   */
  request(
    name: WorkerName,
    payload: unknown,
    options: { timeoutMs?: number; accountId?: string } = {},
  ): Promise<unknown> {
    const timeoutMs = options.timeoutMs ?? 30_000
    const accountId = options.accountId ?? PRIMARY_ACCOUNT_ID
    const key = workerKey(name, accountId)
    const state = this.workers.get(key)
    if (!state?.ready || !state.port) {
      return Promise.reject(new Error(`${key} worker is not ready`))
    }

    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${key} worker did not answer within ${String(timeoutMs)} ms`))
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

  isReady(name: WorkerName, accountId: string = PRIMARY_ACCOUNT_ID): boolean {
    return this.workers.get(workerKey(name, accountId))?.ready ?? false
  }

  /**
   * Orderly shutdown. This matters more than it looks: the NSIS updater kills watis.exe by name
   * only, so a surviving worker still holding the SQLite WAL produces the RETRY/CANCEL
   * "application cannot be closed" dialog and a failed update.
   */
  async stopAll(reason: string, timeoutMs = 4000): Promise<void> {
    await Promise.all(
      [...this.workers.values()].map((state) => this.stopOne(state, reason, timeoutMs)),
    )
  }

  private async stopOne(state: Supervised, reason: string, timeoutMs = 4000): Promise<void> {
    state.stopping = true
    this.clearTimers(state)
    if (!state.process) return
    const child = state.process
    state.port?.postMessage({ type: 'shutdown', reason } satisfies HostToWorker)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        log.warn(`${state.key} worker did not exit in time; killing`)
        child.kill()
        resolve()
      }, timeoutMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}
