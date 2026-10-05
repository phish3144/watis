import type { FaultMessageKey } from '@shared/health/degraded'

/**
 * What the panel says about its own states, in one place: the components show these sentences, and
 * the help renders the same ones with what to do about each (help/articles.ts). A state renamed
 * here is renamed in both, so the help cannot describe a status line the panel no longer shows.
 */

/** The line above the archive: whether WatIs? is writing along. */
export const MIRROR_STATES = {
  starting: {
    label: 'Mitschreiben startet …',
    explain:
      'WhatsApp Web lädt noch oder ist noch nicht verknüpft. Nach dem QR-Code geht es von selbst los.',
  },
  running: {
    label: 'Schreibt mit',
    explain: 'Alles in Ordnung: Jede neue Nachricht kommt ins Archiv.',
  },
  stopped: {
    label: 'Schreibt gerade nicht mit',
    explain:
      'WatIs? kommt an WhatsApps Innenleben nicht heran, meist nach einem Update von WhatsApp Web. WhatsApp läuft normal weiter, und das Archiv bleibt durchsuchbar; nur Neues kommt vorerst nicht dazu. Ein Update von WatIs? behebt das in der Regel.',
  },
} as const

/**
 * The banner at the top, and what to do about each. Typed against every fault the health model
 * knows, so a new fault without advice does not compile.
 */
export const HEALTH_ADVICE: Record<FaultMessageKey, string> = {
  'health.disk-full':
    'Platz schaffen: unter Einstellungen → Speicherplatz den Browser-Cache leeren oder die Mediendateien auf ein anderes Laufwerk verschieben.',
  'health.archive-unavailable':
    'WatIs? startet den Archiv-Prozess von selbst neu. Hält die Meldung an, WatIs? über den Tray beenden und neu starten.',
  'health.bridge-unavailable':
    'Passiert nach einem Update von WhatsApp Web. Unter Einstellungen → Updates nach einer neuen Version von WatIs? suchen.',
  'health.archive-locked': 'Meist nur kurz. Es geht von selbst weiter, sobald die Sperre weg ist.',
  'health.whatsapp-offline':
    'Internetverbindung prüfen. Sobald WhatsApp Web wieder verbunden ist, schreibt WatIs? weiter mit.',
  'health.index-unavailable':
    'Nachrichtentext bleibt durchsuchbar. Der Inhaltsindex startet von selbst neu; hält es an, WatIs? neu starten.',
  'health.phone-offline':
    'Das Handy einschalten und mit dem Internet verbinden. Nur das Nachladen älterer Nachrichten braucht es.',
}

/** Why a chat could not be backfilled, keyed by the bridge's reason. */
export const BACKFILL_REASONS: Record<string, string> = {
  'chat-not-found': 'Chat in WhatsApp nicht gefunden.',
  'module-unresolved':
    'WatIs? findet die Stelle nicht mehr, an der WhatsApp ältere Nachrichten nachlädt — meist nach einem Update von WhatsApp Web.',
  'function-missing':
    'WhatsApp Web bietet das Nachladen an dieser Stelle nicht mehr an — meist nach einem Update.',
  'could-not-open': 'Der Chat ließ sich nicht öffnen.',
  'empty-after-open':
    'Der Chat wurde geöffnet, WhatsApp gab aber keine einzige Nachricht heraus. Das ist kein leerer Chat, sondern ein Problem an der Schnittstelle.',
}

/** Why the backfill is waiting. */
export const BACKFILL_PAUSES: Record<'bridge' | 'in-use', string> = {
  bridge: 'Wartet: keine Verbindung zu WhatsApps Interna.',
  'in-use': 'Wartet auf Leerlauf — das Nachladen öffnet Chats und würde dir dazwischenfunken.',
}
