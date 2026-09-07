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
/**
 * Why message models were rejected, and what one looks like. Names and types only — never values.
 *
 * Measured against a real account: 111 of 111 chats mapped and 0 of 375 messages. That number said
 * the models were there and unreadable, which was already worth three rounds of guessing. Which
 * FIELD was missing is the next question, and it cannot be answered from here — there is no
 * logged-in WhatsApp on this machine or in CI. So the build asks it.
 *
 * Nothing here may carry content. Field names are structure; a chat id is a phone number and a body
 * is a message, so neither is ever recorded. `describe` enforces that by construction: it reports
 * typeof and key names and never a value.
 */
export interface MessageDiagnostics {
  noId: number
  noChatId: number
  noTs: number
  /** The shape of the first model that could not be read. Names only. */
  firstRejected?: Record<string, string>
}

/** A value's shape, never its content: type, and for objects the names of its keys. */
function describe(value: unknown, depth = 1): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  const type = typeof value
  if (type !== 'object') return type
  const keys = Object.keys(value).slice(0, 20)
  if (depth <= 0) return `object{${keys.join(',')}}`
  const inner = keys
    .slice(0, 8)
    .map((k) => `${k}:${describe((value as Record<string, unknown>)[k], depth - 1)}`)
  return `object{${inner.join(', ')}${keys.length > 8 ? ', …' : ''}}`
}

export function toMessageRow(
  model: unknown,
  diagnostics?: MessageDiagnostics,
): MessageRow | undefined {
  const m = model as Record<string, unknown> | null
  if (!m) return undefined

  const id = readId(m.id)
  // Every place the chat a message belongs to has been known to live. `from`/`to` are the same
  // fact seen from either end, so whichever is present answers the question.
  const key = m.id as Record<string, unknown> | undefined
  const chatId = readId(
    m.chatId ??
      key?.remote ??
      (m.chat as Record<string, unknown> | undefined)?.id ??
      (m.fromMe === true || key?.fromMe === true ? m.to : m.from),
  )
  const ts = readTimestamp(m.t ?? (m as { timestamp?: unknown }).timestamp)

  if (id === undefined || chatId === undefined || ts === undefined) {
    if (diagnostics) {
      if (id === undefined) diagnostics.noId++
      if (chatId === undefined) diagnostics.noChatId++
      if (ts === undefined) diagnostics.noTs++
      diagnostics.firstRejected ??= {
        // Own enumerable keys. On a Backbone-style model the interesting ones may hide behind
        // `attributes`, and seeing that is itself the answer, so both are reported.
        keys: Object.keys(m).slice(0, 30).join(','),
        id: describe(m.id),
        chatId: describe(m.chatId),
        t: describe(m.t),
        timestamp: describe((m as { timestamp?: unknown }).timestamp),
        from: describe(m.from, 0),
        to: describe(m.to, 0),
        attributes: describe((m as { attributes?: unknown }).attributes, 0),
        hasGet: String(typeof (m as { get?: unknown }).get === 'function'),
      }
    }
    return undefined
  }

  return {
    id,
    chatId,
    senderJid: readId(m.author ?? m.from),
    ts,
    kind: typeof m.type === 'string' ? m.type : null,
    body: typeof m.body === 'string' ? m.body : typeof m.caption === 'string' ? m.caption : null,
    // quotedMsgId first: it is a MsgKey and serialises to the same form message ids are stored in,
    // so the link resolves. quotedStanzaID is the bare stanza id — a string readId happily returns
    // and which can never match a stored `fromMe_remote_id`, so it is only a last resort.
    quotedId: readId(m.quotedMsgId) ?? readId(m.quotedStanzaID),
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
/**
 * An id, from whichever shape WhatsApp is handing out.
 *
 * `_serialized` used to be the only accepted form, and against a real account that read 111 of 111
 * chats and 0 of 375 messages. A chat id is a Wid, which carries `_serialized`; a message id is a
 * MsgKey, which does not always — where it is a prototype getter it survives, and where a model has
 * been through a structured copy it does not, leaving a plain object with the parts and no getter.
 *
 * So the parts are reassembled into the same string WhatsApp itself produces,
 * `fromMe_remote_id`, rather than the row being thrown away. This invents nothing: it is the
 * documented serialisation, rebuilt from the fields it is made of.
 */
function readId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const v = value as Record<string, unknown> | null
  if (!v) return undefined

  if (typeof v._serialized === 'string') return v._serialized

  // MsgKey's own toString(), which still returns the serialised key.
  //
  // This is the documented route and the reason 375 messages were being dropped: WhatsApp Web
  // >= 2.3000.1042401057 caches the serialised key in a minified property (`this.$1`) instead of
  // `this._serialized`, so the property vanished while toString() kept working. wa-js carries a
  // compatibility patch for exactly this (src/whatsapp/misc/MsgKey.ts, release v4.4.0: "restore
  // MsgKey._serialized on WhatsApp Web >= 2.3000.1042401057"). Wid was never touched, which is why
  // chats mapped and messages did not.
  //
  // The lint rule guards against Object.prototype.toString producing "[object Object]". That is the
  // one case handled explicitly below, by rejecting the result rather than trusting the call.
  if (typeof v.toString === 'function' && v.toString !== Object.prototype.toString) {
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    const serialised = String(v)
    if (serialised !== '' && !serialised.startsWith('[object')) return serialised
  }

  // Last resort: rebuild the key from its parts, in WhatsApp's own format —
  // fromMe_remote_id[_participant]. Independently documented by WAHA's parseMessageIdSerialized.
  // If toString() is minified away too, this keeps working.
  const remote = readId(v.remote)
  if (typeof v.id === 'string' && remote !== undefined) {
    const participant = readId(v.participant)
    return (
      `${v.fromMe === true ? 'true' : 'false'}_${remote}_${v.id}` +
      (participant === undefined ? '' : `_${participant}`)
    )
  }

  // A Wid assembled from its parts, for the same reason.
  if (typeof v.user === 'string' && typeof v.server === 'string') {
    return `${v.user}@${v.server}`
  }

  return undefined
}

/**
 * A message timestamp in seconds.
 *
 * `t` as a number was the only accepted form. WhatsApp has also been seen using a Date and a
 * numeric string, and milliseconds where seconds were expected — and one message model whose `t` is
 * a Date is a message silently dropped, which is indistinguishable from a bridge that does not
 * work at all.
 */
function readTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Past the year 3000 it is milliseconds.
    return value > 32_503_680_000 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (value instanceof Date) return Math.floor(value.getTime() / 1000)
  if (typeof value === 'string' && /^\d+$/.test(value)) return readTimestamp(Number(value))
  return undefined
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
/**
 * How many models each collection held, and how many survived being mapped.
 *
 * "Nachrichten 0" has two completely different causes that look identical from outside: the message
 * collection was empty — WhatsApp Web fills it per chat, on opening — or it was full and every row
 * was dropped by the mapper for want of an id, a chat id or a timestamp. One is expected on a fresh
 * link, the other is a broken bridge, and telling them apart took a round-trip through a user with
 * a real account. Now the snapshot says.
 */
export interface SnapshotTally {
  chat: { models: number; mapped: number }
  contact: { models: number; mapped: number }
  message: { models: number; mapped: number }
  /** Only filled when messages were rejected — see MessageDiagnostics. Names and types, no values. */
  messages: MessageDiagnostics
}

export function* snapshot(
  globals: PageGlobals,
  chunkSize = 200,
  tally?: SnapshotTally,
): Generator<MirrorEvent[]> {
  const sources = [
    { collection: collectionOf(globals, CHAT_COLLECTION), map: toChatRow, kind: 'chat' as const },
    {
      collection: collectionOf(globals, CONTACT_COLLECTION),
      map: toContactRow,
      kind: 'contact' as const,
    },
    {
      collection: collectionOf(globals, MSG_COLLECTION),
      map: (model: unknown) => toMessageRow(model, tally?.messages),
      kind: 'message' as const,
    },
  ]

  for (const source of sources) {
    const models = source.collection?.getModelsArray?.() ?? []
    if (tally) tally[source.kind].models = models.length
    for (let i = 0; i < models.length; i += chunkSize) {
      const batch: MirrorEvent[] = []
      for (const model of models.slice(i, i + chunkSize)) {
        const row = source.map(model)
        if (row) batch.push({ kind: source.kind, row } as MirrorEvent)
      }
      if (tally) tally[source.kind].mapped += batch.length
      if (batch.length > 0) yield batch
    }
  }
}

export function emptyTally(): SnapshotTally {
  return {
    chat: { models: 0, mapped: 0 },
    contact: { models: 0, mapped: 0 },
    message: { models: 0, mapped: 0 },
    messages: { noId: 0, noChatId: 0, noTs: 0 },
  }
}

function collectionOf(
  globals: PageGlobals,
  signature: typeof CHAT_COLLECTION,
): Collection | undefined {
  const result = resolveModule(globals, signature)
  return isFailure(result) ? undefined : (result.value as Collection)
}
