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
 * **Not yet verified against a live session.** Every other signature in this file was checked
 * against the running bundle; this one is written from the module's published name and shape and is
 * therefore `OPTIONAL` — if it does not resolve, media fetching switches off and everything else
 * carries on. The smoke checklist has to confirm it before it may be treated as working
 * (`docs/bridge-smoke.md`).
 *
 * Reading only: it fetches bytes the user's own client already references and decrypts them with
 * the key already in the message. It sends nothing.
 */
export const MEDIA_DOWNLOAD: ModuleSignature = {
  module: 'WAWebDownloadManager',
  path: ['downloadManager'],
  functions: ['downloadAndMaybeDecrypt'],
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
]

export const ALL: readonly ModuleSignature[] = [...REQUIRED, ...OPTIONAL]

/** Features the UI must switch off when the module behind them is gone. */
export const FEATURE_MODULES = {
  archiveMirror: [CHAT_COLLECTION.module, MSG_COLLECTION.module],
  backfill: [LOAD_MESSAGES.module, HISTORY_SYNC.module],
  openInWhatsApp: [CMD.module],
  groupNames: [GROUP_METADATA.module],
  mediaFetch: [MEDIA_DOWNLOAD.module, MSG_COLLECTION.module],
} as const

export function disabledFeatures(available: ReadonlySet<string>): string[] {
  return Object.entries(FEATURE_MODULES)
    .filter(([, modules]) => modules.some((m) => !available.has(m)))
    .map(([feature]) => feature)
}
