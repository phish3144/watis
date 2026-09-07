import { isFailure, resolveModule, type PageGlobals } from './modules'
import { CMD, HISTORY_SYNC, LOAD_MESSAGES, MEDIA_DOWNLOAD, MSG_COLLECTION } from './signatures'

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

export interface LoadOlderResult {
  loaded: number
  oldestTs?: number | undefined
  atFloor: boolean
  reason?: LoadOlderReason | undefined
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

  const fn = options.msgId
    ? callable(globals, CMD, 'openChatAt')
    : (callable(globals, CMD, 'openChatBottom') ?? callable(globals, CMD, 'openChatAt'))
  if (!fn) return false

  await Promise.resolve(fn(options.msgId ? { chat, msgId: options.msgId } : chat))
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
  if (!(await openChat(globals, { chatId }))) {
    return { loaded: 0, atFloor: true, reason: 'could-not-open' }
  }

  const before = await settledCount(chat)
  await Promise.resolve((loadEarlier as Fn)({ chat }))
  // loadEarlierMsgs can resolve before the models land, so the count is given a moment to move
  // rather than being read once and believed.
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
  }
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

/**
 * Fetches one message's attachment through WhatsApp's own downloader.
 *
 * This reads: it asks for bytes the user's client already references and decrypts them with the key
 * already in the message model. It sends nothing, marks nothing, and touches no other message.
 *
 * `MEDIA_DOWNLOAD` is the one signature in this project that has not been checked against a live
 * bundle, so this returns undefined rather than throwing when the module is not what we expect —
 * media fetching switches off and the rest of the archive keeps working.
 */
export async function downloadMedia(
  globals: PageGlobals,
  msgId: string,
): Promise<DownloadedMedia | undefined> {
  const msgResult = resolveModule(globals, MSG_COLLECTION)
  if (isFailure(msgResult)) return undefined
  const collection = (msgResult.value as { get?: (id: string) => unknown } | null) ?? null
  const message = collection?.get?.(msgId) as Record<string, unknown> | undefined
  if (!message) return undefined

  const result = resolveModule(globals, MEDIA_DOWNLOAD)
  if (isFailure(result)) return undefined
  const download = (result.value as Record<string, unknown>).downloadAndMaybeDecrypt
  if (typeof download !== 'function') return undefined

  const blob = await Promise.resolve(
    (download as Fn)({
      directPath: message.directPath,
      encFilehash: message.encFilehash,
      filehash: message.filehash,
      mediaKey: message.mediaKey,
      mediaKeyTimestamp: message.mediaKeyTimestamp,
      type: message.type,
      signal: undefined,
    }),
  )

  const bytes = await toBytes(blob)
  if (!bytes) return undefined

  return {
    data: base64(bytes),
    mime: typeof message.mimetype === 'string' ? message.mimetype : undefined,
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
