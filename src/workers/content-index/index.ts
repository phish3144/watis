import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import { connectToHost, type HostChannel } from '../shared/host-channel'
import { attachArchive } from '../archive/db'
import { extensionFor, shardPath } from '../archive/blob-store'
import { IndexQueue } from './queue'
import { IndexRunner } from './runner'
import { TesseractEngine } from './ocr-engine'
import { PdfEngine } from './pdf-engine'
import { decide, explain, type SchedulerPolicy, type SchedulerSignals } from './scheduler'

/**
 * The content index worker: the `index_jobs` queue, OCR and PDF text extraction (PLAN.md Phase 7).
 *
 * It is its own process for the same reason the archive is: better-sqlite3 is synchronous and OCR
 * runs for minutes, and neither may happen where the window lives.
 *
 * It never decides on its own that now is a good time to work. `powerMonitor` is a main-process
 * API, so the signals — idle time, mains power, the tray's pause switch — are pushed in from there
 * and the policy in `scheduler.ts` turns them into a verdict. A worker that guessed would be a
 * worker that runs OCR while somebody is typing.
 */

const TICK_MS = 5000
/** Jobs per tick. Small, so a change in the signals is acted on within seconds, not minutes. */
const JOBS_PER_TICK = 4

let db: Database.Database | undefined
let queue: IndexQueue | undefined
let runner: IndexRunner | undefined
let blobsDir: string | undefined

let signals: SchedulerSignals = {
  // Until main says otherwise the assumption is that somebody is at the machine. Guessing the
  // other way would mean starting OCR the moment the app launches.
  idleSeconds: () => 0,
  onMainsPower: () => undefined,
  paused: () => false,
}
let policy: SchedulerPolicy = {}
let working = false
let lastVerdict = 'noch nicht entschieden'

/**
 * The blob for a media row. `blobs/` is content-addressed, so the path follows from the hash and
 * nothing has to be looked up beyond the row itself.
 */
async function fileFor(mediaId: string): Promise<{ path: string; mime: string } | undefined> {
  if (!db || !blobsDir) return undefined
  const row = db
    .prepare('SELECT sha256, mime, filename FROM media WHERE id = ? AND status = ?')
    .get(mediaId, 'done') as
    { sha256: string | null; mime: string | null; filename: string | null } | undefined
  if (!row?.sha256) return undefined

  const path = join(blobsDir, shardPath(row.sha256, extensionFor(row.mime, row.filename)))
  try {
    await stat(path)
  } catch {
    // Recorded as present but gone from disk — the runner skips it rather than failing three times.
    return undefined
  }
  return { path, mime: row.mime ?? 'application/octet-stream' }
}

function handle(payload: unknown): unknown {
  const request = payload as { op?: string; [key: string]: unknown }
  switch (request?.op) {
    case 'signals': {
      const idle = typeof request.idleSeconds === 'number' ? request.idleSeconds : 0
      const mains = typeof request.onMainsPower === 'boolean' ? request.onMainsPower : undefined
      const paused = request.paused === true
      signals = { idleSeconds: () => idle, onMainsPower: () => mains, paused: () => paused }
      policy = readPolicy(request.policy)
      return { ok: true }
    }
    case 'status':
      return {
        counts: queue?.counts() ?? null,
        verdict: lastVerdict,
        working,
      }
    case 'reindex': {
      const kind = request.kind as 'ocr' | 'pdf' | 'docx' | 'text' | 'transcript'
      return { requeued: queue?.reindex(kind, now()) ?? 0 }
    }
    default:
      throw new Error(`unknown content-index request: ${String(request?.op)}`)
  }
}

/** Read field by field rather than cast: the payload crosses a process boundary. */
function readPolicy(raw: unknown): SchedulerPolicy {
  const p = (raw ?? {}) as Record<string, unknown>
  const policy: SchedulerPolicy = {}
  if (typeof p.idleThresholdSeconds === 'number')
    policy.idleThresholdSeconds = p.idleThresholdSeconds
  if (typeof p.allowOnBattery === 'boolean') policy.allowOnBattery = p.allowOnBattery
  if (typeof p.concurrency === 'number') policy.concurrency = p.concurrency
  return policy
}

const now = (): number => Math.floor(Date.now() / 1000)

async function tick(host: HostChannel): Promise<void> {
  if (working || !runner || !queue) return

  const verdict = decide(signals, policy)
  lastVerdict = explain(verdict)
  if (!verdict.run) return

  working = true
  try {
    // Jobs abandoned by a crash come back before new ones are claimed, or they would sit in
    // `running` forever and the backlog would quietly shrink by however many were in flight.
    queue.recoverStale(now())
    runner.enqueuePending()
    const outcome = await runner.run(JOBS_PER_TICK)
    if (outcome.processed > 0) {
      host.log(
        'info',
        `indexed ${String(outcome.done)} done, ${String(outcome.skipped)} skipped, ${String(outcome.failed)} failed`,
      )
    }
  } catch (error) {
    host.log('error', `index tick failed: ${String(error)}`)
  } finally {
    working = false
  }
}

/** Waits for the owning process to finish migrating. Bounded, so a real fault still surfaces. */
async function attachWithRetry(
  file: string,
  host: HostChannel,
): Promise<Database.Database | undefined> {
  let delay = 100
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      return attachArchive(file)
    } catch (error) {
      if (attempt === 19) {
        host.send({ type: 'fatal', message: `could not open the archive: ${String(error)}` })
        return undefined
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
      delay = Math.min(delay * 2, 2000)
    }
  }
  return undefined
}

async function main(): Promise<void> {
  const archiveDir = process.env.WATIS_ARCHIVE_DIR
  const blobs = process.env.WATIS_BLOBS_DIR
  const tessdata = process.env.WATIS_TESSDATA_DIR
  if (!archiveDir || !blobs) {
    throw new Error('WATIS_ARCHIVE_DIR and WATIS_BLOBS_DIR must be set; refusing to guess')
  }
  blobsDir = blobs

  // Held in an object because the shutdown handler closes over it before it is set.
  const ticker: { timer?: NodeJS.Timeout } = {}
  const host = await connectToHost({
    name: 'contentIndex',
    onRequest: handle,
    onShutdown: (reason) => {
      host.log('info', `shutting down: ${reason}`)
      if (ticker.timer) clearInterval(ticker.timer)
      runner?.stop()
      try {
        db?.close()
      } catch (error) {
        host.log('warn', `closing the archive failed: ${String(error)}`)
      }
    },
  })

  // The archive worker owns the schema; this one attaches once the migrations are done. Retried
  // rather than failed: at a cold start both workers come up together and the owner may not have
  // finished yet, which is normal and not worth a fatal.
  const file = join(archiveDir, 'archive.sqlite')
  db = await attachWithRetry(file, host)
  if (!db) return

  try {
    queue = new IndexQueue(db)
    runner = new IndexRunner({
      db,
      queue,
      engines: {
        // Without the language data the engine reports itself unavailable and the runner skips
        // those jobs rather than retrying each image three times.
        ocr: new TesseractEngine({ tessdataDir: tessdata ?? '' }),
        pdf: new PdfEngine(),
      },
      fileFor,
      now,
      log: (level, message) => {
        host.log(level, message)
      },
    })
    host.log('info', 'content index ready')
  } catch (error) {
    host.send({ type: 'fatal', message: `could not start the content index: ${String(error)}` })
    return
  }

  ticker.timer = setInterval(() => void tick(host), TICK_MS)
  ticker.timer.unref?.()
}

void main()
