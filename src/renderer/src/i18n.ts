/**
 * UI language is German; identifiers stay English. A plain typed dictionary is enough for a
 * single-locale app — the point of doing it now is that every user-visible string has one home,
 * so adding a locale later is a data change, not a refactor across components.
 */
const de = {
  'app.title': 'WatIs?',
  'status.heading': 'Systemzustand',
  'status.worker.archive': 'Archiv-Prozess',
  'status.worker.contentIndex': 'Index-Prozess',
  'status.worker.running': 'läuft',
  'status.worker.down': 'nicht bereit',
  'status.versions': 'Versionen',
  'status.paths': 'Speicherorte',
  'phase.notice':
    'Phase 0: Das Gerüst steht. Archiv, Suche und Bridge folgen in den nächsten Phasen.',
} as const

export type MessageKey = keyof typeof de

const catalogues = { de } satisfies Record<string, Record<MessageKey, string>>
type Locale = keyof typeof catalogues

let locale: Locale = 'de'

export function setLocale(next: Locale): void {
  locale = next
}

export function t(key: MessageKey): string {
  return catalogues[locale][key]
}
