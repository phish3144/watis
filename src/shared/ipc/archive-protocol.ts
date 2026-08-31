import { z } from 'zod'

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
  z.object({ op: z.literal('snapshot'), toFile: z.string().min(1) }),
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
