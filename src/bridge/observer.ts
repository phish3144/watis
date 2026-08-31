import { isFailure, resolveModule, type PageGlobals } from './modules'
import type { ChatRow, ContactRow, MessageRow, MirrorRow } from '@shared/model/rows'
import { CHAT_COLLECTION, CONTACT_COLLECTION, MSG_COLLECTION } from './signatures'

/**
 * Live mirroring (PLAN.md Phase 3).
 *
 * WhatsApp's collections are Backbone-like: `.on('add')`, `.on('change:<field>')`, `.on('remove')`.
 * Subscribing is the whole mechanism — there is no polling and no diffing, which is what keeps this
 * cheap enough to leave running.
 *
 * Everything here reads. The observer never calls a setter, never marks anything, and hands its
 * output straight to the importer.
 */

export type MirrorEvent = MirrorRow

export interface ObserverHandle {
  /** Detaches every listener. Must be called before the page navigates away. */
  stop(): void
  /** Listeners currently attached, so a healthcheck can tell a dead observer from a quiet one. */
  attached: number
}

interface Collection {
  on?: (event: string, handler: (model: unknown, ...rest: unknown[]) => void) => void
  off?: (event: string, handler: (model: unknown, ...rest: unknown[]) => void) => void
  getModelsArray?: () => unknown[]
}

type Emit = (event: MirrorEvent) => void

/**
 * Normalises one WhatsApp message model.
 *
 * Field names are WhatsApp's and are recorded in `docs/bridge-map.md`. `raw_json` keeps the original
 * so a later schema can be rebuilt from what we already stored rather than from a re-sync that may
 * no longer reach that far back (§5.4).
 */
export function toMessageRow(model: unknown): MessageRow | undefined {
  const m = model as Record<string, unknown> | null
  if (!m) return undefined

  const id = readId(m.id)
  const chatId = readId(m.chatId ?? (m.id as Record<string, unknown> | undefined)?.remote)
  if (id === undefined || chatId === undefined) return undefined

  const ts = typeof m.t === 'number' ? m.t : undefined
  if (ts === undefined) return undefined

  return {
    id,
    chatId,
    senderJid: readId(m.author ?? m.from),
    ts,
    kind: typeof m.type === 'string' ? m.type : null,
    body: typeof m.body === 'string' ? m.body : typeof m.caption === 'string' ? m.caption : null,
    quotedId: readId(m.quotedStanzaID ?? m.quotedMsgId),
    mediaId: typeof m.filehash === 'string' ? m.filehash : null,
    edited: Boolean(m.latestEditMsgKey ?? m.isEdited),
    revoked: m.type === 'revoked' || Boolean(m.isRevoked),
    fromMe: Boolean((m.id as Record<string, unknown> | undefined)?.fromMe ?? m.fromMe),
    rawJson: safeStringify(m),
  }
}

export function toChatRow(model: unknown): ChatRow | undefined {
  const c = model as Record<string, unknown> | null
  const id = readId(c?.id)
  if (!c || id === undefined) return undefined

  return {
    id,
    jid: id,
    name:
      typeof c.name === 'string'
        ? c.name
        : typeof c.formattedTitle === 'string'
          ? c.formattedTitle
          : null,
    kind: c.isGroup === true ? 'group' : c.isBroadcast === true ? 'broadcast' : 'dm',
    lastMsgTs: typeof c.t === 'number' ? c.t : null,
    isArchived: Boolean(c.archive),
    rawJson: safeStringify(c),
  }
}

export function toContactRow(model: unknown): ContactRow | undefined {
  const c = model as Record<string, unknown> | null
  const jid = readId(c?.id)
  if (!c || jid === undefined) return undefined

  return {
    jid,
    name: typeof c.name === 'string' ? c.name : null,
    pushname: typeof c.pushname === 'string' ? c.pushname : null,
    phone: typeof c.userid === 'string' ? c.userid : null,
  }
}

/**
 * A reaction is stored as its own child row rather than folded into the message (§5.4): reactions
 * arrive and disappear independently, and rewriting the parent for each one would churn the search
 * index for text that did not change.
 */
export function toReactionRow(model: unknown): MessageRow | undefined {
  const r = model as Record<string, unknown> | null
  const id = readId(r?.msgKey ?? r?.id)
  const parent = readId(r?.parentMsgKey)
  if (!r || id === undefined || parent === undefined) return undefined

  return {
    id,
    chatId: readId(r.chatId) ?? parent.split('_')[1] ?? parent,
    senderJid: readId(r.senderUserJid),
    ts: typeof r.timestamp === 'number' ? r.timestamp : 0,
    kind: 'reaction',
    body: typeof r.reactionText === 'string' ? r.reactionText : null,
    quotedId: parent,
    rawJson: safeStringify(r),
  }
}

/** WhatsApp ids are sometimes strings, sometimes objects with `_serialized`. Never reshape them. */
function readId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const serialized = (value as Record<string, unknown> | null)?._serialized
  return typeof serialized === 'string' ? serialized : undefined
}

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value)
  } catch {
    // A model with a circular reference is still worth mirroring; we just lose the raw copy.
    return null
  }
}

/**
 * Attaches to the collections and emits normalised rows.
 *
 * `change` is subscribed rather than `change:body`, because an edit, a revoke and an ack all matter
 * and WhatsApp does not promise which field carries them.
 */
export function observe(globals: PageGlobals, emit: Emit): ObserverHandle {
  const detach: (() => void)[] = []

  const bind = (
    collection: Collection | undefined,
    events: readonly string[],
    map: (model: unknown) => MirrorRow['row'] | undefined,
    kind: MirrorEvent['kind'],
  ): void => {
    if (!collection?.on) return
    for (const event of events) {
      const handler = (model: unknown): void => {
        const row = map(model)
        // The pair is built here, where the mapper and the kind were chosen together; the cast
        // says only that those two match, which is the one thing this call site knows.
        if (row) emit({ kind, row } as MirrorEvent)
      }
      collection.on(event, handler)
      detach.push(() => collection.off?.(event, handler))
    }
  }

  bind(collectionOf(globals, CHAT_COLLECTION), ['add', 'change', 'remove'], toChatRow, 'chat')
  bind(collectionOf(globals, MSG_COLLECTION), ['add', 'change'], toMessageRow, 'message')
  bind(collectionOf(globals, CONTACT_COLLECTION), ['add', 'change'], toContactRow, 'contact')

  return {
    stop: () => {
      for (const off of detach) off()
      detach.length = 0
    },
    attached: detach.length,
  }
}

/**
 * The initial import: everything the collections already hold. Yields in chunks so a large mirror
 * does not block the page — WhatsApp Web has to stay usable while this runs (§3.1).
 */
export function* snapshot(globals: PageGlobals, chunkSize = 200): Generator<MirrorEvent[]> {
  const sources = [
    { collection: collectionOf(globals, CHAT_COLLECTION), map: toChatRow, kind: 'chat' as const },
    {
      collection: collectionOf(globals, CONTACT_COLLECTION),
      map: toContactRow,
      kind: 'contact' as const,
    },
    {
      collection: collectionOf(globals, MSG_COLLECTION),
      map: toMessageRow,
      kind: 'message' as const,
    },
  ]

  for (const source of sources) {
    const models = source.collection?.getModelsArray?.() ?? []
    for (let i = 0; i < models.length; i += chunkSize) {
      const batch: MirrorEvent[] = []
      for (const model of models.slice(i, i + chunkSize)) {
        const row = source.map(model)
        if (row) batch.push({ kind: source.kind, row } as MirrorEvent)
      }
      if (batch.length > 0) yield batch
    }
  }
}

function collectionOf(
  globals: PageGlobals,
  signature: typeof CHAT_COLLECTION,
): Collection | undefined {
  const result = resolveModule(globals, signature)
  return isFailure(result) ? undefined : (result.value as Collection)
}
