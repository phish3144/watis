import { z } from 'zod'
import type { ChatRow, ContactRow, MediaRow, MessageRow } from '@shared/model/rows'

/**
 * The archive data plane: import batches in, queries out.
 *
 * Deliberately separate from the control plane in `worker-protocol.ts`. The control plane is
 * validated on every message; this one carries batches of up to 500 rows and cannot afford that on
 * the hot path, so requests are validated at the boundary and responses are trusted — they were
 * built by our own worker, not received from anywhere.
 */

export const chatSchema = z.object({
  id: z.string().min(1),
  jid: z.string().nullish(),
  name: z.string().nullish(),
  kind: z.enum(['dm', 'group', 'broadcast', 'channel']).nullish(),
  lastMsgTs: z.number().int().nullish(),
  isArchived: z.boolean().optional(),
  rawJson: z.string().nullish(),
})

export const contactSchema = z.object({
  jid: z.string().min(1),
  name: z.string().nullish(),
  pushname: z.string().nullish(),
  phone: z.string().nullish(),
})

export const messageSchema = z.object({
  id: z.string().min(1),
  chatId: z.string().min(1),
  senderJid: z.string().nullish(),
  ts: z.number().int(),
  kind: z.string().nullish(),
  body: z.string().nullish(),
  quotedId: z.string().nullish(),
  mediaId: z.string().nullish(),
  edited: z.boolean().optional(),
  revoked: z.boolean().optional(),
  fromMe: z.boolean().optional(),
  rawJson: z.string().nullish(),
})

export const mediaSchema = z.object({
  id: z.string().min(1),
  msgId: z.string().nullish(),
  chatId: z.string().nullish(),
  mime: z.string().nullish(),
  size: z.number().int().nullish(),
  sha256: z.string().nullish(),
  filename: z.string().nullish(),
  status: z.enum(['pending', 'done', 'failed', 'skipped']).optional(),
})

/**
 * The schemas above validate the same shapes `@shared/model/rows` declares, and these assertions
 * fail the build if the two ever stop agreeing. They cost nothing at runtime — `satisfies` on a
 * type-only value is erased — and they catch the failure that has no other symptom: a field added
 * to one description and not the other, silently dropped at the boundary.
 */
// Keys are compared separately from value types on purpose. A bidirectional `extends` alone does
// NOT catch a field added to only one side: an extra optional property stays assignable in both
// directions, which is precisely the drift worth catching.
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never
type SameTypes<A, B> = A extends B ? (B extends A ? true : never) : never
type SchemaCheck<Schema, Row> = SameKeys<Schema, Row> & SameTypes<Schema, Row>
const _chatAgrees: SchemaCheck<z.infer<typeof chatSchema>, ChatRow> = true
const _contactAgrees: SchemaCheck<z.infer<typeof contactSchema>, ContactRow> = true
const _messageAgrees: SchemaCheck<z.infer<typeof messageSchema>, MessageRow> = true
const _mediaAgrees: SchemaCheck<z.infer<typeof mediaSchema>, MediaRow> = true
void [_chatAgrees, _contactAgrees, _messageAgrees, _mediaAgrees]

/** §3.1: import batches are capped at 500 rows so one transaction stays bounded. */
export const MAX_BATCH = 500

export const archiveRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('import'),
    chats: z.array(chatSchema).max(MAX_BATCH).optional(),
    contacts: z.array(contactSchema).max(MAX_BATCH).optional(),
    messages: z.array(messageSchema).max(MAX_BATCH).optional(),
    media: z.array(mediaSchema).max(MAX_BATCH).optional(),
  }),
  z.object({
    op: z.literal('search'),
    query: z.string().max(1000),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0),
    order: z.enum(['recent', 'relevance']).default('recent'),
  }),
  z.object({
    op: z.literal('messagesPage'),
    chatId: z.string().min(1),
    limit: z.number().int().min(1).max(500).default(50),
    before: z.object({ ts: z.number().int(), id: z.string() }).optional(),
    after: z.object({ ts: z.number().int(), id: z.string() }).optional(),
  }),
  z.object({
    op: z.literal('context'),
    msgId: z.string().min(1),
    radius: z.number().int().min(0).max(50).default(3),
  }),
  z.object({ op: z.literal('chats'), limit: z.number().int().min(1).max(1000).default(200) }),
  z.object({ op: z.literal('stats') }),
  z.object({
    op: z.literal('saveSyncState'),
    rows: z
      .array(
        z.object({
          chatId: z.string().min(1),
          oldestTs: z.number().int().nullable().optional(),
          newestTs: z.number().int().nullable().optional(),
          backfillDone: z.boolean().optional(),
          depthLimitTs: z.number().int().nullable().optional(),
          priority: z.number().int().optional(),
          lastError: z.string().nullable().optional(),
        }),
      )
      .max(MAX_BATCH),
  }),
  z.object({ op: z.literal('syncState'), chatId: z.string().min(1).optional() }),
  z.object({
    op: z.literal('storeBlob'),
    mediaId: z.string().min(1),
    /** Base64. A string is the only thing that survives the page and the IPC boundary intact. */
    data: z.string(),
    mime: z.string().nullable().optional(),
    filename: z.string().nullable().optional(),
  }),
  z.object({
    op: z.literal('markMedia'),
    mediaId: z.string().min(1),
    status: z.enum(['pending', 'done', 'failed', 'skipped']),
    reason: z.string().optional(),
  }),
  z.object({ op: z.literal('pendingMedia'), limit: z.number().int().min(1).max(500).default(50) }),
  z.object({ op: z.literal('quota') }),
  z.object({
    op: z.literal('hitPreviews'),
    hits: z
      .array(
        z.object({
          msgId: z.string().nullable(),
          mediaId: z.string().nullable(),
          source: z.string(),
        }),
      )
      .max(200),
    /** So the preview can pick the line the search actually hit, not just the first one. */
    terms: z.array(z.string()).max(20).default([]),
  }),
  z.object({ op: z.literal('snapshot'), toFile: z.string().min(1) }),
  z.object({
    op: z.literal('export'),
    targetDir: z.string().min(1),
    formats: z.array(z.enum(['json', 'html', 'txt'])).min(1),
    /** Only what is new since the last run, tracked in a state file beside the export. */
    incremental: z.boolean().default(true),
    chatIds: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    op: z.literal('backup'),
    targetDir: z.string().min(1),
    /** Media too. Off means database only — much smaller, and still fully searchable text. */
    includeBlobs: z.boolean().default(true),
  }),
])

export type ArchiveRequest = z.infer<typeof archiveRequestSchema>

export interface ArchiveStats {
  messages: number
  chats: number
  media: number
  searchDocs: number
  databaseBytes: number
  /** How many rows are waiting in the ring buffer, so the UI can show backpressure. */
  pendingWrites: number
}

export function parseArchiveRequest(raw: unknown): ArchiveRequest | undefined {
  const result = archiveRequestSchema.safeParse(raw)
  return result.success ? result.data : undefined
}
