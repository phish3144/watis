/**
 * The wire between the page world and the main process.
 *
 * The bridge runs in WhatsApp's own JavaScript context, which has no `ipcRenderer` and must not be
 * given one — anything reachable from the page is reachable by WhatsApp's code. So it talks over
 * DOM `CustomEvent`s, which the sandboxed preload in the isolated world relays. Both worlds share
 * the document; neither shares a scope.
 *
 * The payloads are JSON strings rather than objects: structured clone across worlds would carry
 * live references out of the page, and a string cannot.
 */

import type { MirrorEvent } from './observer'
import type { HealthReport } from './modules'

/** page -> isolated world */
export const TO_HOST = 'watis:bridge-out'
/** isolated world -> page */
export const TO_PAGE = 'watis:bridge-in'

export interface BridgeReady {
  type: 'ready'
  ok: boolean
  version?: string | undefined
  resolved: string[]
  failures: { module: string; reason: string; detail?: string | undefined }[]
  attached: number
}

export interface BridgeBatch {
  type: 'batch'
  events: MirrorEvent[]
  /** Set on the last batch of the initial snapshot, so the host knows the mirror is caught up. */
  snapshotDone?: boolean
}

export interface BridgeResult {
  type: 'result'
  id: number
  ok: boolean
  value?: unknown
  error?: string
}

export type BridgeMessage = BridgeReady | BridgeBatch | BridgeResult

export interface BridgeCommand {
  id: number
  op: 'snapshot' | 'openChat' | 'loadOlder' | 'earliestReachableTs' | 'healthcheck'
  args?: Record<string, unknown>
}

export function summarise(report: HealthReport): Omit<BridgeReady, 'type' | 'attached'> {
  return {
    ok: report.ok,
    version: report.version,
    resolved: report.resolved.map((r) => r.signature.module),
    failures: report.failures.map((f) => ({
      module: f.signature.module,
      reason: f.reason,
      detail: f.detail,
    })),
  }
}
