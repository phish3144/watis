import { isFailure, resolveModule, type PageGlobals } from './modules'
import {
  CMD,
  HISTORY_SYNC,
  LOAD_MESSAGES,
  MEDIA_CACHE,
  MEDIA_DOWNLOAD,
  MEDIA_ORIGIN,
  MEDIA_QPL,
  MEDIA_TYPES,
  MSG_COLLECTION,
} from './signatures'

/**
 * The only operations the bridge is allowed to perform.
 *
 * `require('WAWebCmd')` returns an object that also carries `sendStarMsgs`, `sendDeleteMsgs`,
 * `sendRevokeMsgs` and `Revoke`. Nothing in WhatsApp's code stops us using them. This module is the
 * barrier: it names each permitted call, never returns the raw object to anyone, and is the single
 * place any of them may be invoked from (CLAUDE.md, ADR 0006).
 *
 * Adding a call here that writes is a change to the project's rules, not to a file.
 */

export interface OpenChatOptions {
  chatId: string
  /** Scroll to this message rather than the bottom. */
  msgId?: string | undefined
}

/**
 * Why nothing came back, when nothing came back.
 *
 * Every one of these used to be reported as `{ loaded: 0, atFloor: true }` — indistinguishable from
 * "this chat has no more history", which is what the backfill then recorded for all 110 chats. A
 * fault that is shaped exactly like success is the most expensive kind, so they are named now.
 */
export type LoadOlderReason =
  | 'chat-not-found'
  | 'module-unresolved'
  | 'function-missing'
  | 'could-not-open'
  | 'empty-after-open'
  | 'at-floor'
  /** WhatsApp's own code threw. `detail` says where and what — see the note in loadOlder. */
  | 'threw'

export interface LoadOlderResult {
  loaded: number
  oldestTs?: number | undefined
  atFloor: boolean
  reason?: LoadOlderReason | undefined
  /**
   * Structure, for a failure that needs explaining. Never content: no chat id, no message body.
   * A shape here is the difference between another guess and a fix.
   */
  detail?: string | undefined
}

type Fn = (...args: unknown[]) => unknown

function callable(globals: PageGlobals, signature: typeof CMD, name: string): Fn | undefined {
  const result = resolveModule(globals, signature)
  if (isFailure(result)) return undefined
  const target = result.value as Record<string, unknown> | null
  const fn = target?.[name]
  return typeof fn === 'function' ? (fn.bind(target) as Fn) : undefined
}

/**
 * Opens a chat, optionally at a message.
 *
 * WhatsApp marks the chat read as a consequence, and that is accepted: it is the same thing the user
 * would cause by clicking the chat themselves (ADR 0006). What stays forbidden is calling this for
 * chats nobody asked to see.
 */
export async function openChat(globals: PageGlobals, options: OpenChatOptions): Promise<boolean> {
  const chat = await findChat(globals, options.chatId)
  if (!chat) return false

  // Always openChatBottom, and always with the object form.
  //
  // Two version changes collided here. Since WhatsApp Web >= 2.3000.1029960097 the signature is
  // `openChatBottom({ chat, chatEntryPoint, threadId })`; the positional `openChatBottom(chat)` is
  // deprecated. Passing the chat positionally makes WhatsApp destructure `chat` out of a ChatModel,
  // get undefined, and read `.id` on it — which is exactly the "Cannot read properties of undefined
  // (reading 'id')" that killed 15 chats in a backfill run.
  //
  // openChatAt is not used for the jump either: its second parameter is a `msgContext` built by
  // WhatsApp's own getSearchContext, not a message id. Passing `{ chat, msgId }` set a field that
  // does not exist in the signature, so scrolling to a message never worked. Until that context can
  // be built properly, opening the chat at its bottom is the honest subset — the chat opens, and
  // the caller is told the message was not jumped to.
  const fn = callable(globals, CMD, 'openChatBottom') ?? callable(globals, CMD, 'openChatAt')
  if (!fn) return false

  try {
    await Promise.resolve(fn({ chat }))
  } catch {
    // Older WhatsApp builds take the chat positionally. Tried second so the current form wins.
    await Promise.resolve(fn(chat))
  }
  return true
}

/**
 * Asks for one page of older messages in a chat.
 *
 * `loadEarlierMsgs` takes a `trigger` that defaults to USER_SCROLL, and the default is left alone:
 * any other value would be a claim about where the request came from that we cannot substantiate,
 * and the default is what the interface itself sends (ADR 0006).
 */
export async function loadOlder(globals: PageGlobals, chatId: string): Promise<LoadOlderResult> {
  const chat = await findChat(globals, chatId)
  if (!chat) return { loaded: 0, atFloor: true, reason: 'chat-not-found' }

  const result = resolveModule(globals, LOAD_MESSAGES)
  if (isFailure(result)) return { loaded: 0, atFloor: true, reason: 'module-unresolved' }
  const loadEarlier = (result.value as Record<string, unknown>).loadEarlierMsgs
  if (typeof loadEarlier !== 'function') {
    return { loaded: 0, atFloor: true, reason: 'function-missing' }
  }

  // Opening the chat first is what makes any of this work.
  //
  // WhatsApp Web fills `chat.msgs` lazily, when a chat is opened. On a chat nobody has opened it is
  // empty, and loadEarlierMsgs has no anchor to page back from — so it returns nothing, the count
  // does not move, and the chat looks exactly like one with no history left. Measured against a
  // real account: 110 chats, 514 imported rows, zero messages, and a backfill that called every
  // single chat done.
  //
  // The Effects interface in the state machine has always said this function "opens the chat and
  // asks for one page of older messages". It only ever did the second half.
  //
  // Opening is the same thing the user would do by clicking the chat. CLAUDE.md lists it among the
  // permitted reads, ADR 0006 covers the read receipt it causes, and the backfill panel warns about
  // it in as many words.
  // The chat is NOT opened here.
  //
  // It used to be, on every call — and the backfill calls this once per page, so a chat of 1450
  // messages was opened around 29 times. Slow, and it drags WhatsApp's visible chat back and forth
  // under the user for nothing. The backfill opens each chat once, before its first page; WhatsApp
  // only needs that once for the message collection to exist.
  const before = await settledCount(chat)
  let returned: unknown
  try {
    // The return value is the array of messages that arrived. Polling chat.msgs afterwards was a
    // guess at the same number and needed a 2-second wait to make it; this is the answer, given
    // directly. The poll stays below as a fallback for a build that returns nothing.
    returned = await Promise.resolve((loadEarlier as Fn)({ chat }))
  } catch (error: unknown) {
    return {
      loaded: 0,
      atFloor: true,
      reason: 'threw',
      detail: `loadEarlierMsgs: ${String(error)} | msgs=${describeShape(
        (chat as { msgs?: unknown } | null)?.msgs,
      )}`,
    }
  }
  if (Array.isArray(returned) && returned.length > 0) {
    return { loaded: returned.length, oldestTs: oldestTimestamp(chat), atFloor: false }
  }

  // No array, or an empty one. An empty array means both "nothing older" and "the request failed",
  // which WhatsApp does not distinguish, so the collection is still consulted before concluding
  // anything: it can resolve before the models land.
  const after = await countAfter(chat, before)

  if (after > before) {
    return { loaded: after - before, oldestTs: oldestTimestamp(chat), atFloor: false }
  }

  // Nothing arrived. Which of the two it is matters: a chat that is open and holds messages has
  // genuinely reached its floor, while one that is open and still holds none means the page never
  // gave us its history at all — a bridge problem wearing the costume of an empty chat.
  return {
    loaded: 0,
    oldestTs: oldestTimestamp(chat),
    atFloor: true,
    reason: after === 0 ? 'empty-after-open' : 'at-floor',
    // Only when it went wrong, and only the shape: if `msgs` is not where messageCount looks, the
    // count can never move and every chat looks empty however well the rest works.
    ...(after === 0
      ? { detail: `msgs=${describeShape((chat as { msgs?: unknown } | null)?.msgs)}` }
      : {}),
  }
}

/**
 * A value's shape, never its content — type, and for an object the names of its keys.
 *
 * The same rule as the snapshot diagnostics: names are structure, values are somebody's messages.
 */
function describeShape(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value !== 'object') return typeof value
  const keys = Object.keys(value).slice(0, 15)
  const length = (value as { length?: unknown }).length
  const models = (value as { models?: unknown[] }).models
  return (
    `object{${keys.join(',')}}` +
    ` length=${typeof length === 'number' ? String(length) : typeof length}` +
    ` models=${Array.isArray(models) ? String(models.length) : typeof models}`
  )
}

/** A short, bounded pause. The bridge runs in the page, so this is the page's own clock. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** The message count once opening the chat has had a moment to populate it. */
async function settledCount(chat: unknown): Promise<number> {
  for (let i = 0; i < 10; i++) {
    const count = messageCount(chat)
    if (count > 0) return count
    await pause(100)
  }
  return messageCount(chat)
}

/** The message count after a page was requested, waiting up to two seconds for it to move. */
async function countAfter(chat: unknown, before: number): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const count = messageCount(chat)
    if (count > before) return count
    await pause(100)
  }
  return messageCount(chat)
}

/** The reachable history date. Undefined when the module is gone — never a number of our own. */
export async function earliestReachableTs(globals: PageGlobals): Promise<number | undefined> {
  const result = resolveModule(globals, HISTORY_SYNC)
  if (isFailure(result)) return undefined
  const fn = (result.value as Record<string, unknown>).getEarliestHistorySyncDate
  if (typeof fn !== 'function') return undefined

  const value = await Promise.resolve((fn as Fn)())
  if (value instanceof Date) return plausible(Math.floor(value.getTime() / 1000))
  if (typeof value === 'number' && Number.isFinite(value)) {
    // WhatsApp has returned both seconds and milliseconds here across versions; anything past the
    // year 3000 is milliseconds.
    return plausible(value > 32_503_680_000 ? Math.floor(value / 1000) : Math.floor(value))
  }
  return undefined
}

/** WhatsApp did not exist before 2009, so nothing earlier can be a date it reached back to. */
const WHATSAPP_EPOCH = 1_230_768_000

/**
 * The value only if it can actually be a date.
 *
 * Against a real account this returned 7_776_000 — which is not a timestamp at all but exactly
 * ninety days in seconds, the length of the window rather than its start. Read as an absolute time
 * it is the 1st of April 1970, and that is what the panel showed: "Erreichbar laut WhatsApp:
 * 01.04.1970", presented as something WhatsApp had said.
 *
 * A duration is interpreted as one, since that is demonstrably what this version hands back.
 * Anything else that cannot be a date becomes undefined, and the panel says "unbekannt" — which is
 * honest, and better than a confident wrong answer attributed to WhatsApp.
 */
function plausible(seconds: number): number | undefined {
  if (seconds >= WHATSAPP_EPOCH) return seconds
  // Small enough to be a window length rather than a point in time: at most ten years back.
  if (seconds > 0 && seconds <= 10 * 365 * 24 * 3600) return Math.floor(Date.now() / 1000) - seconds
  return undefined
}

export interface DownloadedMedia {
  /** The bytes, base64. A string is the only thing that crosses the world boundary safely. */
  data: string
  mime?: string | undefined
  filename?: string | undefined
  size: number
}

/** A file the bridge did not fetch on purpose, and why — recorded on the row, never retried blindly. */
export interface SkippedMedia {
  skipped: string
}

/**
 * The tracing object WhatsApp's downloader insists on (`downloadQpl`), as a stand-in that does
 * nothing. All nine members, because WhatsApp hands it to its decryption worker when that is
 * switched on, and that path asks for `getQPLAttrs` and `isActive` and clones the result — a stub
 * with only `addAnnotations` fails there. A plain frozen object: the downloader copies its argument
 * shallowly, and only plain own properties survive that.
 */
const NOOP_QPL = Object.freeze({
  addAnnotations: () => undefined,
  addPoint: () => undefined,
  start: () => undefined,
  isActive: () => false,
  getQPLAttrs: () => ({ markerId: 0, instanceKey: 0 }),
  endSuccess: () => undefined,
  endFail: () => undefined,
  endFailWithError: () => undefined,
  endCancel: () => undefined,
})
const QPL_MEMBERS = [
  'addAnnotations',
  'addPoint',
  'getQPLAttrs',
  'isActive',
  'endSuccess',
  'endFailWithError',
  'endCancel',
] as const
type Qpl = Record<(typeof QPL_MEMBERS)[number], Fn>

/** A download WhatsApp itself would give up on long before this; it only bounds a hung request. */
const DOWNLOAD_TIMEOUT_MS = 120_000

interface MediaTypes {
  getMsgMediaType: (msg: unknown) => unknown
  getValidMimeTypes: (type: unknown) => { has?: (mime: unknown) => boolean } | undefined
  mediaTypeToMsgTypeSupportedByAllowlist: (type: string) => unknown
}

function optionalModule(globals: PageGlobals, signature: typeof MEDIA_CACHE): unknown {
  const result = resolveModule(globals, signature)
  return isFailure(result) ? undefined : result.value
}

/**
 * Fetches one message's attachment through WhatsApp's own downloader.
 *
 * This reads: it asks for bytes the user's client already references and decrypts them with the key
 * already in the message model. It sends nothing, marks nothing, and touches no other message. The
 * paths that could send something — WhatsApp's "re-upload this media" request, the message model's
 * own `downloadMedia` with `downloadEvenIfExpensive` — are never used (docs/bridge-map.md).
 *
 * In order, stopping at the first that works:
 * 1. WhatsApp's in-memory cache of media this tab already decrypted — no network.
 * 2. The message's own decrypted blob, if WhatsApp attached one — no network.
 * 3. `downloadAndMaybeDecrypt`, called the way WhatsApp calls it since 2.3000.1049110567: with a
 *    `downloadQpl` tracing object (its own, or the stand-in), the media type WhatsApp computes, and
 *    the message's mimetype verbatim. Without `downloadQpl` it fails at once with "Cannot read
 *    properties of undefined (reading 'addAnnotations')"; without the mimetype, every type but
 *    documents fails WhatsApp's allowlist.
 *
 * Before 3, the bridge checks what the downloader would check and skips what it would refuse:
 * view-once media, a mimetype the allowlist does not hold, SVG documents, missing keys. The
 * downloader reports such failures to WhatsApp; the bridge never gives it the occasion.
 *
 * Returns undefined when the modules are not what we expect: media fetching switches off and the
 * rest of the archive keeps working.
 */
export async function downloadMedia(
  globals: PageGlobals,
  msgId: string,
  manual = false,
): Promise<DownloadedMedia | SkippedMedia | undefined> {
  const msgResult = resolveModule(globals, MSG_COLLECTION)
  if (isFailure(msgResult)) return undefined
  const collection = (msgResult.value as { get?: (id: string) => unknown } | null) ?? null
  const message = collection?.get?.(msgId) as Record<string, unknown> | undefined
  if (!message) return undefined

  // Deliberately not archived (docs/recon.md): the sender chose "view once".
  if (message.isViewOnce === true) return { skipped: 'view-once media is not archived' }
  if (typeof message.filehash !== 'string') return { skipped: 'the message has no attachment' }

  const managerResult = resolveModule(globals, MEDIA_DOWNLOAD)
  const typesResult = resolveModule(globals, MEDIA_TYPES)
  if (isFailure(managerResult) || isFailure(typesResult)) return undefined
  const manager = managerResult.value as { downloadAndMaybeDecrypt: Fn }
  const types = typesResult.value as MediaTypes

  let type: string
  try {
    type = String(types.getMsgMediaType(message))
  } catch {
    return { skipped: 'WhatsApp does not treat this message as media' }
  }
  const mimetype = typeof message.mimetype === 'string' ? message.mimetype : undefined

  const cached = cachedBlob(globals, message.filehash, message)
  if (cached) return finished(await toBytes(cached), mimetype, message)

  const refusal = refusalFor(types, type, mimetype, message)
  if (refusal) return { skipped: refusal }

  let downloadOrigin: unknown
  try {
    const origin = optionalModule(globals, MEDIA_ORIGIN)
    downloadOrigin = typeof origin === 'function' ? (origin as Fn)(message) : undefined
  } catch {
    downloadOrigin = undefined
  }

  const qpl = startQpl(globals)
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, DOWNLOAD_TIMEOUT_MS)
  try {
    // A method call, with the manager as `this` — WhatsApp's code may rely on it.
    const plain = await Promise.resolve(
      manager.downloadAndMaybeDecrypt.call(manager, {
        directPath: message.directPath,
        staticUrl: message.staticUrl,
        encFilehash: message.encFilehash,
        filehash: message.filehash,
        mediaKey: message.mediaKey,
        mediaKeyTimestamp: message.mediaKeyTimestamp,
        type,
        mimetype,
        downloadQpl: qpl,
        downloadOrigin,
        // Goes into the media URL; WhatsApp's own automatic downloads say "auto".
        mode: manual ? 'manual' : 'auto',
        userDownloadAttemptCount: 0,
        isViewOnce: false,
        signal: controller.signal,
      }),
    )
    try {
      qpl.endSuccess()
    } catch {
      // Tracing is WhatsApp's business; a failure there is not ours.
    }
    return finished(await toBytes(plain), mimetype, message)
  } catch (error: unknown) {
    try {
      if (controller.signal.aborted) qpl.endCancel('watis_timeout')
      else qpl.endFailWithError('download_failed', (error as { name?: unknown } | null)?.name)
    } catch {
      // as above
    }
    const name = (error as { name?: unknown } | null)?.name
    // 404/410: gone from WhatsApp's servers. Asking for a re-upload would be a request to the
    // server, which the bridge does not make; the phone may still have it.
    if (name === 'MediaNotFoundError') return { skipped: "no longer on WhatsApp's servers" }
    if (name === 'InvalidMediaFileType') return { skipped: 'WhatsApp refuses this file' }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Tiers 1 and 2: what this tab has already decrypted. Pure reads. */
function cachedBlob(
  globals: PageGlobals,
  filehash: string,
  message: Record<string, unknown>,
): unknown {
  try {
    const cache = optionalModule(globals, MEDIA_CACHE) as { get?: Fn } | undefined
    const blob = cache?.get?.(filehash)
    if (blob) return blob
  } catch {
    // Not there; go on.
  }
  try {
    // getBlob, not forceToBlob: the latter converts WhatsApp's object in place and throws once it
    // has been released.
    const media = message.mediaData as { mediaBlob?: { getBlob?: Fn } | null } | undefined
    const blob = media?.mediaBlob?.getBlob?.()
    if (blob) return blob
  } catch {
    // as above
  }
  return undefined
}

/** What WhatsApp's downloader would refuse, checked the same way before it is asked. */
function refusalFor(
  types: MediaTypes,
  type: string,
  mimetype: string | undefined,
  message: Record<string, unknown>,
): string | undefined {
  try {
    const allowlistType = types.mediaTypeToMsgTypeSupportedByAllowlist(type)
    if (allowlistType !== null && allowlistType !== undefined) {
      // Exact and case-sensitive, as WhatsApp checks it. Normalising the mimetype would get a file
      // past a gate WhatsApp put there on purpose.
      const allowed = types.getValidMimeTypes(allowlistType)
      if (!allowed?.has?.(mimetype))
        return `WhatsApp does not accept ${mimetype ?? 'an unknown type'} as ${type}`
    } else if ((mimetype ?? '').toLowerCase() === 'image/svg+xml') {
      return 'WhatsApp blocks SVG documents'
    }
  } catch {
    return "WhatsApp's media types could not be read"
  }
  // Channel media is not encrypted; everything else needs its key.
  const encrypted = !type.startsWith('newsletter-')
  if (
    encrypted &&
    (typeof message.mediaKey !== 'string' || typeof message.encFilehash !== 'string')
  ) {
    return 'the message carries no key for its attachment'
  }
  if (!message.directPath && !message.staticUrl) return 'the message has no download path'
  return undefined
}

/** WhatsApp's own tracing object where it can be had in the shape we know, else the stand-in. */
function startQpl(globals: PageGlobals): Qpl {
  try {
    const factory = optionalModule(globals, MEDIA_QPL) as { startMediaDownloadQpl?: Fn } | undefined
    const qpl = factory?.startMediaDownloadQpl?.({ entryPoint: 'MediaDownload' }) as
      Record<string, unknown> | undefined
    if (qpl && QPL_MEMBERS.every((member) => typeof qpl[member] === 'function')) {
      return qpl as unknown as Qpl
    }
  } catch {
    // Fall through to the stand-in.
  }
  return NOOP_QPL
}

function finished(
  bytes: Uint8Array | undefined,
  mimetype: string | undefined,
  message: Record<string, unknown>,
): DownloadedMedia | SkippedMedia {
  if (!bytes) return { skipped: 'WhatsApp did not hand over the file' }
  return {
    data: base64(bytes),
    mime: mimetype,
    filename: typeof message.filename === 'string' ? message.filename : undefined,
    size: bytes.length,
  }
}

/** WhatsApp has returned a Blob, an ArrayBuffer and a Uint8Array here across versions. */
async function toBytes(value: unknown): Promise<Uint8Array | undefined> {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  const blob = value as { arrayBuffer?: () => Promise<ArrayBuffer> } | null
  if (typeof blob?.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return undefined
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  // In chunks: String.fromCharCode with a few hundred thousand arguments overflows the stack.
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return btoa(binary)
}

async function findChat(globals: PageGlobals, chatId: string): Promise<unknown> {
  const { CHAT_COLLECTION } = await import('./signatures')
  const result = resolveModule(globals, CHAT_COLLECTION)
  if (isFailure(result)) return undefined
  const collection = result.value as { get?: (id: string) => unknown } | null
  return typeof collection?.get === 'function' ? collection.get(chatId) : undefined
}

function messageCount(chat: unknown): number {
  const msgs = (chat as { msgs?: { length?: number; models?: unknown[] } } | null)?.msgs
  return msgs?.length ?? msgs?.models?.length ?? 0
}

function oldestTimestamp(chat: unknown): number | undefined {
  const models = (chat as { msgs?: { models?: { t?: number }[] } } | null)?.msgs?.models
  if (!Array.isArray(models) || models.length === 0) return undefined
  const times = models.map((m) => m.t).filter((t): t is number => typeof t === 'number')
  return times.length > 0 ? Math.min(...times) : undefined
}
