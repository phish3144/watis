import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { settings } from '../config/store'
import { appPaths } from '../paths'
import { log } from '../logging'

/**
 * The timed export (PLAN.md Phase 6): readable files dropped into a folder on a schedule, so
 * restic, rsync or a synced drive can pick them up without this application being involved.
 *
 * The schedule is deliberately dumb — check every few minutes whether enough time has passed —
 * rather than one long timer. A long timer is wrong every time the machine sleeps, which on a
 * laptop is most of the time, and "wrong" here means a backup that silently never ran.
 */

const CHECK_INTERVAL_MS = 5 * 60 * 1000

interface ScheduleState {
  lastRunMs?: number
  lastError?: string
  lastResult?: { chats: number; messages: number }
}

export interface ExportScheduleOptions {
  archive: (request: unknown) => Promise<unknown>
  /** Overridable so a test does not have to wait five minutes. */
  checkIntervalMs?: number | undefined
}

export class ExportSchedule {
  readonly #options: ExportScheduleOptions
  #timer: NodeJS.Timeout | undefined
  #running = false
  #state: ScheduleState = {}

  async start(): Promise<void> {
    this.#state = await readState()
    if (this.#timer) return
    this.#timer = setInterval(
      () => void this.tick(),
      this.#options.checkIntervalMs ?? CHECK_INTERVAL_MS,
    )
    this.#timer.unref?.()
  }

  constructor(options: ExportScheduleOptions) {
    this.#options = options
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  state(): ScheduleState & { nextDueMs?: number } {
    const config = settings()
    if (!config.scheduledExportEnabled) return { ...this.#state }
    const last = this.#state.lastRunMs
    return {
      ...this.#state,
      nextDueMs:
        last === undefined ? Date.now() : last + config.scheduledExportEveryHours * 3600_000,
    }
  }

  /** Runs if it is due. Called on a timer and on demand; overlapping runs are skipped. */
  async tick(force = false): Promise<boolean> {
    const config = settings()
    if (this.#running) return false
    if (!force) {
      if (!config.scheduledExportEnabled) return false
      const last = this.#state.lastRunMs ?? 0
      if (Date.now() - last < config.scheduledExportEveryHours * 3600_000) return false
    }
    if (!config.scheduledExportDir) {
      this.#state.lastError = 'kein Zielordner eingestellt'
      return false
    }

    this.#running = true
    try {
      const result = (await this.#options.archive({
        op: 'export',
        targetDir: config.scheduledExportDir,
        formats: config.scheduledExportFormats,
        incremental: true,
      })) as { chats?: number; messages?: number }

      this.#state = {
        lastRunMs: Date.now(),
        lastResult: { chats: result.chats ?? 0, messages: result.messages ?? 0 },
      }
      log.info(
        `scheduled export wrote ${String(result.messages ?? 0)} messages from ${String(result.chats ?? 0)} chats`,
      )
      await writeState(this.#state)
      return true
    } catch (error: unknown) {
      // Recorded and shown, not swallowed. A backup that quietly stopped running is the worst
      // kind: it looks exactly like one that works.
      this.#state.lastError = String(error)
      log.warn(`scheduled export failed: ${String(error)}`)
      await writeState(this.#state)
      return false
    } finally {
      this.#running = false
    }
  }
}

/**
 * The schedule's bookkeeping lives beside the logs, not in the export folder: the target may be a
 * removable drive, and a schedule that forgets when it last ran because a stick is unplugged would
 * fire on every single check.
 */
function stateFile(): string {
  return join(appPaths().root, 'export-schedule.json')
}

async function readState(): Promise<ScheduleState> {
  try {
    return JSON.parse(await readFile(stateFile(), 'utf8')) as ScheduleState
  } catch {
    return {}
  }
}

async function writeState(state: ScheduleState): Promise<void> {
  try {
    await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8')
  } catch (error: unknown) {
    log.warn(`could not record the export schedule state: ${String(error)}`)
  }
}
