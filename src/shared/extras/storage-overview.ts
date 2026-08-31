/**
 * The storage overview (PLAN.md Phase 9).
 *
 * The official client gives no answer at all to "what is using my disk", which is how people end up
 * deleting the whole profile. This names each part and, crucially, says which parts may be cleared.
 */

export interface StorageSection {
  key: 'sessionCache' | 'archive' | 'blobs' | 'models' | 'indexQueue' | 'logs'
  label: string
  bytes: number
  /**
   * Whether clearing it is safe. The session partition's *storage* is never safe — deleting it
   * means scanning the QR code again — while its HTTP cache is (CLAUDE.md, "Session ist heilig").
   */
  clearable: boolean
  note?: string | undefined
}

export interface StorageOverview {
  sections: StorageSection[]
  totalBytes: number
  clearableBytes: number
}

export function buildOverview(input: {
  sessionCacheBytes: number
  archiveBytes: number
  blobBytes: number
  modelBytes: number
  indexQueueBytes: number
  logBytes: number
}): StorageOverview {
  const sections: StorageSection[] = [
    {
      key: 'sessionCache',
      label: 'Browser-Cache von WhatsApp Web',
      bytes: input.sessionCacheBytes,
      clearable: true,
      note: 'Nur HTTP-, GPU- und Code-Cache. Anmeldung und lokale Daten bleiben unberührt.',
    },
    {
      key: 'archive',
      label: 'Archiv (Nachrichten und Suchindex)',
      bytes: input.archiveBytes,
      clearable: false,
      note: 'Das eigentliche Archiv. Nur über Export und bewusstes Löschen.',
    },
    {
      key: 'blobs',
      label: 'Mediendateien',
      bytes: input.blobBytes,
      clearable: false,
      note: 'Einzelne Chats lassen sich gezielt freigeben; pauschal löschen würde das Archiv entwerten.',
    },
    {
      key: 'models',
      label: 'Modelle für Texterkennung und Transkription',
      bytes: input.modelBytes,
      clearable: true,
      note: 'Werden bei Bedarf erneut geladen.',
    },
    {
      key: 'indexQueue',
      label: 'Warteschlange des Inhaltsindex',
      bytes: input.indexQueueBytes,
      clearable: true,
    },
    { key: 'logs', label: 'Protokolle', bytes: input.logBytes, clearable: true },
  ]

  return {
    sections,
    totalBytes: sections.reduce((sum, s) => sum + s.bytes, 0),
    clearableBytes: sections.filter((s) => s.clearable).reduce((sum, s) => sum + s.bytes, 0),
  }
}

/** German byte sizes, because the overview is a UI string and the UI is German. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1)
  return `${rounded.replace('.', ',')} ${units[unit] ?? 'TB'}`
}
