/**
 * What the application does when a part of it is broken (PLAN.md Phase 9).
 *
 * The rule throughout: say what is wrong and keep working on everything else. An application that
 * hides a failure teaches people not to trust it — and the specific failures below are all ones a
 * user can act on, so hiding them is also unhelpful.
 */

export type Fault =
  | 'whatsapp-offline'
  | 'phone-offline'
  | 'bridge-unavailable'
  | 'archive-unavailable'
  | 'archive-locked'
  | 'disk-full'
  | 'index-unavailable'

export interface Capability {
  key: 'read' | 'archiveGrows' | 'search' | 'backfill' | 'mediaFetch' | 'contentIndex' | 'export'
  available: boolean
  /** Which fault took it away, when it is gone. */
  because?: Fault | undefined
}

export interface HealthState {
  faults: Fault[]
  capabilities: Capability[]
  /** Message key for the banner, or undefined when everything works. */
  banner?: FaultMessageKey | undefined
  severity: 'ok' | 'degraded' | 'broken'
}

/**
 * Which capability each fault takes away. A fault never disables more than it must — losing the
 * bridge stops the archive from growing but leaves everything already archived searchable, and
 * that distinction is the difference between a usable application and a dead one.
 */
const IMPACT: Record<Fault, Capability['key'][]> = {
  'whatsapp-offline': ['archiveGrows', 'backfill', 'mediaFetch'],
  'phone-offline': ['backfill'],
  'bridge-unavailable': ['archiveGrows', 'backfill', 'mediaFetch'],
  'archive-unavailable': ['archiveGrows', 'search', 'export', 'contentIndex'],
  'archive-locked': ['archiveGrows', 'contentIndex'],
  'disk-full': ['archiveGrows', 'mediaFetch', 'contentIndex', 'export'],
  'index-unavailable': ['contentIndex'],
}

/**
 * The banner text itself lives in the renderer's message catalogue, so shared code stays free of
 * UI language. What belongs here is which fault the user should be told about.
 */
export type FaultMessageKey = `health.${Fault}`

/** Ordered worst-first, so the banner shows the fault that explains the most. */
const SEVERITY_ORDER: Fault[] = [
  'disk-full',
  'archive-unavailable',
  'bridge-unavailable',
  'archive-locked',
  'whatsapp-offline',
  'index-unavailable',
  'phone-offline',
]

const ALL_CAPABILITIES: Capability['key'][] = [
  'read',
  'archiveGrows',
  'search',
  'backfill',
  'mediaFetch',
  'contentIndex',
  'export',
]

export function assess(faults: readonly Fault[]): HealthState {
  const unique = [...new Set(faults)]
  const lost = new Map<Capability['key'], Fault>()

  // Worst first, so a capability lost to two faults is attributed to the one worth acting on.
  for (const fault of SEVERITY_ORDER) {
    if (!unique.includes(fault)) continue
    for (const key of IMPACT[fault]) if (!lost.has(key)) lost.set(key, fault)
  }

  const capabilities = ALL_CAPABILITIES.map((key): Capability => {
    const because = lost.get(key)
    return because === undefined ? { key, available: true } : { key, available: false, because }
  })

  const worst = SEVERITY_ORDER.find((f) => unique.includes(f))

  return {
    faults: unique,
    capabilities,
    ...(worst ? { banner: `health.${worst}` as const } : {}),
    severity:
      worst === undefined
        ? 'ok'
        : capabilities.find((c) => c.key === 'search')?.available === false
          ? 'broken'
          : 'degraded',
  }
}

/**
 * Reading is never taken away. Even with every worker dead, WhatsApp Web itself keeps running in
 * its view — the wrapper failing must not cost the user the messenger.
 */
export function canStillReadMessages(state: HealthState): boolean {
  return state.capabilities.find((c) => c.key === 'read')?.available ?? true
}

/** Maps a raw error to a fault, so callers do not each invent their own string matching. */
export function faultFromError(error: unknown): Fault | undefined {
  const message = String(error).toUpperCase()
  if (message.includes('ENOSPC') || message.includes('NO SPACE')) return 'disk-full'
  if (message.includes('SQLITE_BUSY') || message.includes('DATABASE IS LOCKED'))
    return 'archive-locked'
  if (message.includes('IS NOT READY') || message.includes('DID NOT ANSWER'))
    return 'archive-unavailable'
  return undefined
}
