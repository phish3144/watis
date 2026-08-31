import { powerMonitor } from 'electron'
import { settings } from './config/store'
import type { WorkerSupervisor } from './workers/supervisor'
import { log } from './logging'

/**
 * Feeds the content index worker the signals it cannot read itself (PLAN.md Phase 7).
 *
 * `powerMonitor` is a main-process API and the worker is a utilityProcess, so idle time and mains
 * power have to be pushed across. The worker decides — the policy lives with the queue in
 * `scheduler.ts` — but it decides on numbers from here.
 *
 * Pushed on a timer rather than on events because idle time has no event: it is a value that keeps
 * changing while nothing happens, which is precisely the condition being waited for.
 */
const PUSH_MS = 5000

export function startIndexSignals(supervisor: WorkerSupervisor): () => void {
  let lastPaused: boolean | undefined

  const push = (): void => {
    if (!supervisor.isReady('contentIndex')) return
    const config = settings()

    void supervisor
      .request('contentIndex', {
        op: 'signals',
        idleSeconds: idleSeconds(),
        onMainsPower: onMainsPower(),
        paused: config.indexPaused,
        policy: {
          idleThresholdSeconds: config.indexIdleThresholdSeconds,
          allowOnBattery: config.indexOnBattery,
          concurrency: config.indexConcurrency,
        },
      })
      .catch((error: unknown) => {
        log.warn(`could not push index signals: ${String(error)}`)
      })

    if (config.indexPaused !== lastPaused) {
      log.info(`content index ${config.indexPaused ? 'paused' : 'resumed'} by the user`)
      lastPaused = config.indexPaused
    }
  }

  const timer = setInterval(push, PUSH_MS)
  timer.unref?.()
  push()
  return () => {
    clearInterval(timer)
  }
}

function idleSeconds(): number {
  try {
    return powerMonitor.getSystemIdleTime()
  } catch {
    // No idle information: treat the user as present. The other guess would run OCR under their
    // hands, which is the failure this policy exists to prevent.
    return 0
  }
}

function onMainsPower(): boolean | undefined {
  try {
    // A desktop has no battery and `onBatteryPower` is false there, which is the right answer.
    return !powerMonitor.onBatteryPower
  } catch {
    return undefined
  }
}
