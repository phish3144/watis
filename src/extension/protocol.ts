import type { BridgeCommand, BridgeReady } from '../bridge/protocol'
import type { ImporterStats } from '../main/archive/importer'
import type { MediaFetcherStats } from '../main/archive/media-fetcher'
import type { UnreadCounts } from '../preload/page-reading'

export type { UnreadCounts }

/**
 * Who says what to whom inside the extension (ADR 0010).
 *
 *   WhatsApp tab                         extension
 *   ┌───────────────────────────┐        ┌────────────────────────────────┐
 *   │ page world: bridge, shims │        │ background: badge, toasts,     │
 *   │      ▲ CustomEvent (JSON) │        │   downloads — keeps no state   │
 *   │ relay (content script)  ──┼─msg──▶ │ archive host: the one context  │
 *   │ host frame (hidden)       │        │   holding the database         │
 *   └───────────────────────────┘        │ panel: archive UI, settings    │
 *                                         └────────────────────────────────┘
 *
 * Everything is JSON, as on the desktop: nothing that crosses a boundary carries a live object out
 * of WhatsApp's page. Messages go out with `runtime.sendMessage`, which every extension context
 * receives; each context answers only the kinds it owns, and only the archive host that actually
 * holds the database answers archive requests. That is how a second WhatsApp tab, or a panel
 * opened before the tab, never ends up with a second writer.
 */

/** Requests answered by the context that owns the database. */
export type HostRequest =
  | { kind: 'archive'; request: unknown }
  /** Fetch one attachment now, past the automatic rules — "videos on click". */
  | { kind: 'fetch-media'; mediaId: string }
  /** Copy the database out of OPFS, for a backup the user downloads. */
  | { kind: 'export-database' }

/** Reports from the relay in a WhatsApp tab to the background. */
export type RelayReport =
  | { kind: 'unread'; counts: UnreadCounts }
  | { kind: 'notify'; notification: PageNotification }
  | { kind: 'notify-close'; id: string }
  | { kind: 'active-chat'; title: string }
  | { kind: 'download-name'; name: string }
  | { kind: 'bridge-ready'; report: BridgeReady }
  | { kind: 'importer'; stats: ImporterStats }
  /** Relayed from the archive frame, which cannot reach the background itself in Firefox. */
  | { kind: 'host-status'; status: HostStatus }
  | { kind: 'media-stats'; stats: MediaFetcherStats }

/** Sent by the background or the host into one WhatsApp tab (`tabs.sendMessage`). */
export type RelayCommand =
  | { kind: 'bridge'; op: BridgeCommand['op']; args?: Record<string, unknown> }
  | { kind: 'notify-event'; id: string; type: 'click' | 'close' }

/** Broadcast by the relay when the importer needs a destination, and by a host when it has one. */
export type Presence = { kind: 'host-online' } | { kind: 'host-wanted' }

export type ExtensionMessage = HostRequest | RelayReport | RelayCommand | Presence

export interface PageNotification {
  id: string
  title: string
  body: string
  tag: string
  icon: string
}

/** Every answer is wrapped, so an error reaches the caller as a value instead of as silence. */
export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Shared, inspectable state, kept in `storage.session` by whoever learns it — one key per fact, so
 * the background and the host never overwrite each other's half of a shared object.
 *
 * Push-only status went wrong once already on the desktop: a panel that mounted after the last
 * push sat on `undefined` forever (main/index.ts, bridgeReports). Storage can be read on mount and
 * watched afterwards, so the panel never depends on having been open at the right moment.
 */
export const STATUS = {
  bridge: 'watis:bridge',
  importer: 'watis:importer',
  unread: 'watis:unread',
  host: 'watis:host',
  media: 'watis:media',
  activeChat: 'watis:active-chat',
} as const

export interface ExtensionStatus {
  bridge?: (BridgeReady & { at: number }) | undefined
  importer?: (ImporterStats & { at: number }) | undefined
  unread?: UnreadCounts | undefined
  host?: HostStatus | undefined
  media?: (MediaFetcherStats & { at: number }) | undefined
}

export interface HostStatus {
  /** Where the database is open: in the WhatsApp tab, or in the panel when no tab is open. */
  where: 'tab' | 'panel'
  at: number
  error?: string | undefined
}

export const SETTINGS_KEY = 'watis:settings'

export function isMessage(value: unknown): value is ExtensionMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  )
}
