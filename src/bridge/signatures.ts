import type { ModuleSignature } from './modules'

/**
 * The modules the bridge needs, and the shape each must have.
 *
 * Every entry here is a promise about somebody else's undocumented code. The signature is what turns
 * a silent behaviour change into a named failure at startup, which is the whole point: WhatsApp
 * ships continuously and we find out on their schedule, not ours.
 *
 * Names verified against the live bundle; see `docs/bridge-map.md` for the version and the date.
 */

export const CHAT_COLLECTION: ModuleSignature = {
  module: 'WAWebChatCollection',
  path: ['ChatCollection'],
  functions: ['get', 'getModelsArray'],
}

export const MSG_COLLECTION: ModuleSignature = {
  module: 'WAWebMsgCollection',
  path: ['MsgCollection'],
  functions: ['get'],
}

export const CONTACT_COLLECTION: ModuleSignature = {
  module: 'WAWebContactCollection',
  path: ['ContactCollection'],
  functions: ['get', 'getModelsArray'],
}

export const GROUP_METADATA: ModuleSignature = {
  module: 'WAWebGroupMetadataCollection',
  path: ['GroupMetadataCollection'],
  functions: ['get'],
}

/** Paging older messages into a chat — the engine behind Phase 5. */
export const LOAD_MESSAGES: ModuleSignature = {
  module: 'WAWebChatLoadMessages',
  functions: ['loadEarlierMsgs'],
}

/**
 * Opening a chat and scrolling to a message.
 *
 * The same object also carries sendStarMsgs, sendDeleteMsgs, sendRevokeMsgs and Revoke. There is no
 * technical barrier between reading and writing here — only the wrapper in `operations.ts`, which
 * names the calls it permits and never hands the raw object on (ADR 0006).
 */
export const CMD: ModuleSignature = {
  module: 'WAWebCmd',
  path: ['Cmd'],
  functions: ['openChatAt', 'openChatBottom'],
}

/** The reachable history date, read at runtime and never hardcoded (ADR 0005 A). */
export const HISTORY_SYNC: ModuleSignature = {
  module: 'WAWebHistorySyncUtils',
  functions: ['getEarliestHistorySyncDate'],
}

/**
 * Fetching and decrypting a message's attachment through WhatsApp's own downloader.
 *
 * Checked against the login page of WA Web 2.3000.1049110567 on 2026-10-02: the module, the
 * function and the argument it reads (see `operations.ts` and `docs/bridge-map.md`). Not yet checked
 * by a real download in a logged-in session, so it stays `OPTIONAL` — if it does not resolve, media
 * fetching switches off and everything else carries on.
 *
 * Reading only: it fetches bytes the user's own client already references and decrypts them with
 * the key already in the message. It sends nothing.
 */
export const MEDIA_DOWNLOAD: ModuleSignature = {
  module: 'WAWebDownloadManager',
  path: ['downloadManager'],
  functions: ['downloadAndMaybeDecrypt'],
}

/**
 * WhatsApp's media types and its exact mimetype allowlist. The downloader wants the type WhatsApp
 * computes itself (`getMsgMediaType`, not `msg.type`), and it checks the mimetype against this list
 * before fetching anything. The bridge runs that check first, so a file WhatsApp would refuse never
 * reaches the downloader — whose failure path reports to WhatsApp.
 */
export const MEDIA_TYPES: ModuleSignature = {
  module: 'WAWebMmsMediaTypes',
  functions: ['getMsgMediaType', 'getValidMimeTypes', 'mediaTypeToMsgTypeSupportedByAllowlist'],
}

/** The tracing object the downloader insists on (`downloadQpl`). A no-op stand-in works without it. */
export const MEDIA_QPL: ModuleSignature = {
  module: 'WAWebStartMediaDownloadQpl',
  functions: ['startMediaDownloadQpl'],
}

/** Media this tab has already decrypted, read without going to the network. */
export const MEDIA_CACHE: ModuleSignature = {
  module: 'WAWebMediaInMemoryBlobCache',
  path: ['InMemoryMediaBlobCache'],
  functions: ['get'],
}

/** Where a download comes from — chat, group, channel — as WhatsApp reports it. Its export is the function. */
export const MEDIA_ORIGIN: ModuleSignature = {
  module: 'WAWebMediaGetDownloadOriginForMsg',
}

export const REQUIRED: readonly ModuleSignature[] = [
  CHAT_COLLECTION,
  MSG_COLLECTION,
  CONTACT_COLLECTION,
]

export const OPTIONAL: readonly ModuleSignature[] = [
  GROUP_METADATA,
  LOAD_MESSAGES,
  CMD,
  HISTORY_SYNC,
  MEDIA_DOWNLOAD,
  MEDIA_TYPES,
  MEDIA_QPL,
  MEDIA_CACHE,
  MEDIA_ORIGIN,
]

export const ALL: readonly ModuleSignature[] = [...REQUIRED, ...OPTIONAL]

/** Features the UI must switch off when the module behind them is gone. */
export const FEATURE_MODULES = {
  archiveMirror: [CHAT_COLLECTION.module, MSG_COLLECTION.module],
  backfill: [LOAD_MESSAGES.module, HISTORY_SYNC.module],
  openInWhatsApp: [CMD.module],
  groupNames: [GROUP_METADATA.module],
  mediaFetch: [MEDIA_DOWNLOAD.module, MEDIA_TYPES.module, MSG_COLLECTION.module],
} as const

export function disabledFeatures(available: ReadonlySet<string>): string[] {
  return Object.entries(FEATURE_MODULES)
    .filter(([, modules]) => modules.some((m) => !available.has(m)))
    .map(([feature]) => feature)
}
