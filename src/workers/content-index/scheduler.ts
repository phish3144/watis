/**
 * Decides when the content index may work (PLAN.md Phase 7).
 *
 * OCR and transcription run for minutes at a time. Doing that while the user is typing, or on
 * battery, turns a background feature into a reason to uninstall — so the rule is: only on idle,
 * only on mains power, and stoppable from the tray at any moment.
 *
 * The signals arrive as injected predicates rather than Electron calls, which is what lets the
 * policy be tested at all.
 */

export interface SchedulerSignals {
  /** Seconds since the last input event; Electron's powerMonitor.getSystemIdleTime(). */
  idleSeconds(): number
  /** False on battery. Undefined where the platform cannot say — a desktop has no battery. */
  onMainsPower(): boolean | undefined
  /** The tray's pause switch. */
  paused(): boolean
}

export interface SchedulerPolicy {
  /** How long the user must be idle before indexing starts. */
  idleThresholdSeconds?: number
  /** Run on battery anyway. Off by default. */
  allowOnBattery?: boolean
  /** How many jobs may run at once. */
  concurrency?: number
}

export type Verdict =
  | { run: true; concurrency: number }
  | { run: false; reason: 'paused' | 'user-active' | 'on-battery' }

export function decide(signals: SchedulerSignals, policy: SchedulerPolicy = {}): Verdict {
  const idleThreshold = policy.idleThresholdSeconds ?? 60
  const concurrency = Math.max(1, Math.min(policy.concurrency ?? 1, 4))

  // The pause switch wins over everything: the user asked for quiet, and no other signal outranks
  // that.
  if (signals.paused()) return { run: false, reason: 'paused' }
  if (signals.idleSeconds() < idleThreshold) return { run: false, reason: 'user-active' }

  const mains = signals.onMainsPower()
  // A machine with no battery reports undefined; treating that as "on battery" would mean a desktop
  // never indexes at all.
  if (mains === false && policy.allowOnBattery !== true) return { run: false, reason: 'on-battery' }

  return { run: true, concurrency }
}

/** Wording for the storage overview, so a stalled queue explains itself instead of looking broken. */
export function explain(verdict: Verdict): string {
  if (verdict.run) return `läuft mit ${String(verdict.concurrency)} Job(s) gleichzeitig`
  switch (verdict.reason) {
    case 'paused':
      return 'pausiert'
    case 'user-active':
      return 'wartet auf Leerlauf'
    case 'on-battery':
      return 'wartet auf Netzstrom'
  }
}
