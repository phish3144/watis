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

/**
 * Faults that a source can be asked about directly, rather than only inferred from an error.
 *
 * These are the ones where a remembered failure must never outlive the condition: the source knows
 * better than the memory does, always.
 */
const LEVEL_TRIGGERED: readonly Fault[] = [
  'archive-unavailable',
  'index-unavailable',
  'whatsapp-offline',
]

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

  /**
   * The current state, computed now.
   *
   * This used to return the cached `#last`, and CI caught it saying exactly this:
   *
   *   search=false faults=[archive-unavailable] workers={"archive":true,"contentIndex":true}
   *
   * The worker was ready and the monitor was reporting it unavailable — a cached answer that had
   * stopped matching the thing it described. The cache was fed by a one-second poll and, later, by
   * a readiness notification; both are ways of keeping a copy fresh, and both were patched in turn
   * while the copy went stale anyway.
   *
   * A copy that can go stale is the bug. The sources here are three boolean reads and a link-state
   * check, so there is no reason to hold a copy at all for a reader: refresh first, then answer.
   * `#last` stays, but only for deciding whether anything CHANGED and a listener should hear about
   * it — which is what a cache is legitimately for.
   */
  state(): HealthState {
    this.refresh()
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

    // The level-triggered sources first, because they are the authority on their own faults.
    const live = new Set<Fault>()
    if (!this.#sources.workerReady('archive')) live.add('archive-unavailable')
    if (!this.#sources.workerReady('contentIndex')) live.add('index-unavailable')
    // `net.isOnline()` is the machine's own link state, so it distinguishes "no network at all"
    // from "WhatsApp is unreachable" — but a loaded document proves reachability outright, and
    // that is the stronger signal, so it wins.
    if (!this.#sources.whatsappLoaded() || !net.isOnline()) live.add('whatsapp-offline')

    // A transient copy of a fault that HAS a live source is dropped the moment that source says
    // the condition has cleared.
    //
    // This is what was actually breaking the health check, through three attempted fixes that all
    // addressed the wrong half. At startup something asks the archive before its worker is up and
    // gets "archive@default worker is not ready"; faultFromError maps "IS NOT READY" to
    // archive-unavailable, and report() caches it for sixty seconds. The worker comes up a moment
    // later, workerReady('archive') turns true — and the union below kept the cached copy alive
    // anyway. The panel showed "broken" over a working archive with search disabled, for a full
    // minute, and no amount of refreshing helped: the stale value was not a cache of the answer,
    // it was an input to it.
    //
    // Expiry is for faults nothing can observe directly — a failed write, a locked database. For a
    // fault with a live source, that source is better information than a sixty-second-old memory.
    for (const fault of LEVEL_TRIGGERED) {
      if (!live.has(fault)) this.#transient.delete(fault)
    }

    const faults: Fault[] = [...live]
    for (const [fault, until] of this.#transient) {
      if (until <= now) this.#transient.delete(fault)
      else faults.push(fault)
    }

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
