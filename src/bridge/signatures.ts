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
]

export const ALL: readonly ModuleSignature[] = [...REQUIRED, ...OPTIONAL]

/** Features the UI must switch off when the module behind them is gone. */
export const FEATURE_MODULES = {
  archiveMirror: [CHAT_COLLECTION.module, MSG_COLLECTION.module],
  backfill: [LOAD_MESSAGES.module, HISTORY_SYNC.module],
  openInWhatsApp: [CMD.module],
  groupNames: [GROUP_METADATA.module],
} as const

export function disabledFeatures(available: ReadonlySet<string>): string[] {
  return Object.entries(FEATURE_MODULES)
    .filter(([, modules]) => modules.some((m) => !available.has(m)))
    .map(([feature]) => feature)
}
