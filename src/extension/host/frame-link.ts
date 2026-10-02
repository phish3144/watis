import type { BridgeCommand } from '../../bridge/protocol'
import type { MediaFetcherStats } from '../../main/archive/media-fetcher'
import type { HostStatus, Reply } from '../protocol'

/**
 * The private line between the relay (content script) and the archive frame in the same tab.
 *
 * Why not extension messaging: in Firefox an extension page framed into a web page gets only the
 * content-script set of APIs — no `tabs`, no `storage.session`, no `downloads` — and does not hear
 * `runtime.sendMessage` broadcasts the way a top-level extension page does (measured with Firefox
 * 157, ADR 0010). A MessagePort handed over by the relay works the same in every browser.
 *
 * The port is handed over with `postMessage`, which WhatsApp's page could imitate. So the relay
 * first puts a random token into `storage.local` under the frame's id — storage the page cannot
 * read — and the frame accepts only a port that arrives with that token.
 */

export const CONNECT = 'watis-connect'

export const frameTokenKey = (frameId: string): string => `watis:frame:${frameId}`

/** relay → frame */
export type ToFrame =
  | { id: number; kind: 'archive'; request: unknown }
  | { id: number; kind: 'fetch-media'; mediaId: string }
  | { id: number; kind: 'export-database' }
  | { id: number; kind: 'transcribe'; mediaId: string; path: string }
  | { kind: 'bridge-state'; ok: boolean }
  /** The answer to a bridge command the frame asked for. */
  | { id: number; kind: 'reply'; reply: Reply }

/** frame → relay */
export type FromFrame =
  /** The answer to one of the relay's requests. */
  | { id: number; kind: 'reply'; reply: Reply }
  /** The media fetcher needs the bridge, which lives in this tab's page world. */
  | { id: number; kind: 'bridge'; op: BridgeCommand['op']; args?: Record<string, unknown> }
  | { kind: 'status'; status: HostStatus }
  | { kind: 'media'; stats: MediaFetcherStats }

export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
