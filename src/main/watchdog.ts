import { monitorEventLoopDelay } from 'node:perf_hooks'
import { log } from './logging'

/**
 * The main process coordinates; it does not compute. This watchdog makes a violation of that
 * rule visible instead of merely felt.
 *
 * Note on reading the numbers: the histogram floor equals the resolution, so a raw p99 of
 * 13.6ms at resolution 10 is really ~3.6ms of lag. The resolution is subtracted before
 * comparing against the budget.
 */
const RESOLUTION_MS = 10
const BUDGET_MS = 16
const REPORT_INTERVAL_MS = 30_000

export function startEventLoopWatchdog(): () => void {
  const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS })
  histogram.enable()

  const timer = setInterval(() => {
    const p99Ms = histogram.percentile(99) / 1e6 - RESOLUTION_MS
    const maxMs = histogram.max / 1e6 - RESOLUTION_MS
    if (maxMs > BUDGET_MS) {
      log.warn(
        `event loop lag over budget: max ${maxMs.toFixed(1)}ms, p99 ${p99Ms.toFixed(1)}ms ` +
          `(budget ${BUDGET_MS}ms). Something is computing in the main process.`,
      )
    }
    histogram.reset()
  }, REPORT_INTERVAL_MS)
  timer.unref()

  return () => {
    clearInterval(timer)
    histogram.disable()
  }
}
