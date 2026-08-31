import { net } from 'electron'
import { assess, faultFromError, type Fault, type HealthState } from '@shared/health/degraded'
import { log } from '../logging'

/**
 * Collects the faults the application can actually observe and turns them into one state the UI
 * can show (PLAN.md Phase 9, "Fehlerpfade").
 *
 * Faults arrive from two directions. Some are level-triggered — a worker is down, the machine is
 * offline — and stay set until the condition clears. Others are edge-triggered: a request came
 * back `ENOSPC`. Those cannot un-set themselves, so they expire, and the next attempt either
 * re-raises them or lets them lapse. Without the expiry a single failed write would leave a
 * permanent red banner over an application that had recovered a second later.
 */
const TRANSIENT_TTL_MS = 60_000

export interface HealthSources {
  /** Whether each worker answered its last handshake. */
  workerReady: (name: 'archive' | 'contentIndex') => boolean
  /** Whether the WhatsApp view currently has a loaded document. */
  whatsappLoaded: () => boolean
}

export class HealthMonitor {
  readonly #sources: HealthSources
  readonly #listeners = new Set<(state: HealthState) => void>()
  readonly #transient = new Map<Fault, number>()
  #last: HealthState = assess([])
  #timer: NodeJS.Timeout | undefined

  constructor(sources: HealthSources) {
    this.#sources = sources
  }

  /**
   * Polls the level-triggered sources. One second is far below what a person notices and far
   * above what costs anything — the check is three boolean reads.
   */
  start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => {
      this.refresh()
    }, 1000)
    this.#timer.unref()
    this.refresh()
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = undefined
  }

  state(): HealthState {
    return this.#last
  }

  onChange(listener: (state: HealthState) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Called by anything that catches an error it cannot handle. Unknown errors are ignored. */
  report(error: unknown): Fault | undefined {
    const fault = faultFromError(error)
    if (!fault) return undefined
    this.#transient.set(fault, Date.now() + TRANSIENT_TTL_MS)
    this.refresh()
    return fault
  }

  /** Explicitly raised by the bridge health check and the backfill, which know their own state. */
  set(fault: Fault, active: boolean): void {
    if (active) this.#transient.set(fault, Date.now() + TRANSIENT_TTL_MS)
    else this.#transient.delete(fault)
    this.refresh()
  }

  refresh(): void {
    const now = Date.now()
    const faults: Fault[] = []

    for (const [fault, until] of this.#transient) {
      if (until <= now) this.#transient.delete(fault)
      else faults.push(fault)
    }

    if (!this.#sources.workerReady('archive')) faults.push('archive-unavailable')
    if (!this.#sources.workerReady('contentIndex')) faults.push('index-unavailable')
    // `net.isOnline()` is the machine's own link state, so it distinguishes "no network at all"
    // from "WhatsApp is unreachable" — but a loaded document proves reachability outright, and
    // that is the stronger signal, so it wins.
    if (!this.#sources.whatsappLoaded() || !net.isOnline()) faults.push('whatsapp-offline')

    const next = assess(faults)
    if (sameState(next, this.#last)) return
    this.#last = next
    if (next.banner) log.warn(`degraded: ${next.faults.join(', ')}`)
    else log.info('health recovered')
    for (const listener of this.#listeners) listener(next)
  }
}

function sameState(a: HealthState, b: HealthState): boolean {
  return a.faults.length === b.faults.length && a.faults.every((f) => b.faults.includes(f))
}
