import type { Reply } from '../protocol'

/** Between the archive host and its worker. Both sides are ours; structured clone is fine. */

export type ToWorker =
  | { type: 'open'; quotaBytes: number }
  | { type: 'configure'; quotaBytes?: number; indexPaused?: boolean }
  | { type: 'request'; id: number; payload: unknown }
  | { type: 'export'; id: number }

export type FromWorker =
  | { type: 'opened'; ok: true }
  /** `busy`: another context holds the database. Not an error — the host retries later. */
  | { type: 'opened'; ok: false; busy: boolean; error: string }
  | { type: 'reply'; id: number; reply: Reply }
  | { type: 'log'; level: 'info' | 'warn'; message: string }
