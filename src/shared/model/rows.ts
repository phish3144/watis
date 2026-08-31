/**
 * The normalised shapes, in one place (PLAN.md Phase 3, "Datennormalisierung … Typen in `shared/`").
 *
 * Three parts of the application handle these rows and none of them shares a process: the bridge
 * produces them inside WhatsApp's page, the importer batches them in main, and the repository
 * writes them in the archive worker. They were previously described twice — once as interfaces in
 * the repository, once as zod schemas on the IPC boundary — which is exactly the arrangement where
 * two descriptions of the same thing drift apart without anything failing.
 *
 * So the types live here, the schemas validate against them at the boundary, and
 * `archive-protocol.ts` carries a compile-time assertion that the two still agree.
 *
 * `rawJson` holds WhatsApp's original object. It is not decoration: a later schema can be rebuilt
 * from what was already stored rather than from a re-sync that may no longer reach back that far
 * (§5.4).
 */

export interface ChatRow {
  id: string
  jid?: string | null | undefined
  name?: string | null | undefined
  kind?: ChatKind | null | undefined
  lastMsgTs?: number | null | undefined
  isArchived?: boolean | undefined
  rawJson?: string | null | undefined
}

export type ChatKind = 'dm' | 'group' | 'broadcast' | 'channel'

export interface ContactRow {
  jid: string
  name?: string | null | undefined
  pushname?: string | null | undefined
  phone?: string | null | undefined
}

export interface MessageRow {
  id: string
  chatId: string
  senderJid?: string | null | undefined
  ts: number
  kind?: string | null | undefined
  body?: string | null | undefined
  quotedId?: string | null | undefined
  mediaId?: string | null | undefined
  edited?: boolean | undefined
  revoked?: boolean | undefined
  fromMe?: boolean | undefined
  rawJson?: string | null | undefined
}

export type MediaStatus = 'pending' | 'done' | 'failed' | 'skipped'

export interface MediaRow {
  id: string
  msgId?: string | null | undefined
  chatId?: string | null | undefined
  mime?: string | null | undefined
  size?: number | null | undefined
  sha256?: string | null | undefined
  filename?: string | null | undefined
  status?: MediaStatus | undefined
}

/**
 * One chat's backfill bookkeeping. `depthLimitTs` is what WhatsApp said it can still reach, not a
 * figure of ours (ADR 0005 A) — so a chat whose `oldestTs` has arrived at it is finished, and one
 * that stopped earlier stopped for a reason worth showing.
 */
export interface SyncStateRow {
  chatId: string
  oldestTs?: number | null | undefined
  newestTs?: number | null | undefined
  backfillDone?: boolean | undefined
  depthLimitTs?: number | null | undefined
  priority?: number | undefined
  lastError?: string | null | undefined
  updatedTs?: number | null | undefined
}

/**
 * What the bridge emits and the importer batches. Discriminated on `kind`, so a consumer that has
 * checked the kind gets the right row type without a cast — and one that has not is made to.
 */
export type MirrorRow =
  | { kind: 'chat'; row: ChatRow }
  | { kind: 'contact'; row: ContactRow }
  | { kind: 'message'; row: MessageRow }
  | { kind: 'media'; row: MediaRow }

export type MirrorKind = MirrorRow['kind']
