/**
 * UI language is German; identifiers stay English. A plain typed dictionary is enough for a
 * single-locale app — the point of doing it now is that every user-visible string has one home,
 * so adding a locale later is a data change rather than a refactor across components.
 */
const de = {
  'app.title': 'WatIs?',
  'app.subtitle': 'Einstellungen und Status',

  'section.window': 'Fenster und Tray',
  'section.notifications': 'Benachrichtigungen',
  'section.appearance': 'Darstellung',
  'section.declutter': 'Entrümpeln',
  'section.input': 'Eingabe',
  'section.files': 'Dateien',
  'section.media': 'Medien und Eingabe',
  'section.status': 'Status',
  'section.index': 'Inhaltsindex',
  'section.backup': 'Export und Sicherung',
  'section.storage': 'Speicherplatz',

  'window.closeToTray': 'Schließen minimiert in den Tray',
  'window.closeToTray.hint':
    'Das Fenster verschwindet, die App läuft weiter und meldet neue Nachrichten.',
  'window.startMinimised': 'Minimiert starten',
  'window.autostart': 'Beim Anmelden starten',
  'window.autostart.hintMac':
    'Unter macOS erst verfügbar, wenn die App signiert und notarisiert ist.',
  'window.shortcut': 'Globaler Schnellzugriff',
  'window.shortcut.hint':
    'Blendet das Fenster ein und aus, auch wenn eine andere App im Vordergrund ist.',

  'notify.enabled': 'Benachrichtigungen anzeigen',
  'notify.suppressWhenVisible': 'Nicht melden, wenn der Chat schon offen ist',
  'notify.suppressWhenVisible.hint': 'Kein Ping für den Chat, den du gerade liest.',
  'notify.coalesce': 'Bündelung',
  'notify.coalesce.hint': 'Pro Chat eine Meldung in diesem Zeitfenster, danach eine Sammelmeldung.',
  'notify.muted': 'Auch stummgeschaltete Chats melden',
  'notify.dnd': 'Ruhezeit',
  'notify.dnd.from': 'von',
  'notify.dnd.to': 'bis',

  'appearance.compact': 'Kompaktmodus',
  'appearance.compact.hint': 'Engere Zeilen in Chatliste und Verlauf.',
  'appearance.fontScale': 'Schriftgröße',
  'appearance.customCss': 'Eigene CSS-Datei verwenden',
  'appearance.customCss.hint': 'Liest user.css aus dem Datenordner.',

  'declutter.channels': 'Kanäle ausblenden',
  'declutter.status': 'Status / „Aktuelles" ausblenden',
  'declutter.metaAi': 'Meta AI ausblenden',
  'declutter.hint': 'Blendet nur aus. Es wird nichts aus der Seite entfernt.',

  'input.enterNewline': 'Enter fügt einen Zeilenumbruch ein',
  'input.enterNewline.hint': 'Gesendet wird dann mit Strg+Enter.',
  'input.spellcheck': 'Rechtschreibprüfung',
  'input.spellcheck.hint':
    'Aus, solange keine Sprache gewählt ist. Unter Windows lädt Chromium das Wörterbuch beim ersten Einschalten von einem Google-Server — sonst geht kein Netzverkehr an Dritte.',
  'input.spellcheck.none': 'aus',

  'media.audioOut': 'Audioausgabe',
  'media.audioOut.hint':
    'Gilt für Sprachnachrichten und Videos. Leer heißt: das Gerät, das das System vorgibt.',
  'media.audioOut.default': 'Systemvorgabe',
  'media.zoom.hint':
    'Im Bildbetrachter zoomt das Mausrad, Ziehen verschiebt, + − 0 gehen auch über die Tastatur.',

  'files.downloadDir': 'Zielordner',
  'files.sortByChat': 'Nach Chat in Unterordner sortieren',
  'files.notify': 'Nach dem Speichern melden',
  'files.scheme': 'Schema',

  'status.unread': 'Ungelesen',
  'status.muted': 'davon stumm',
  'status.archive': 'Archiv-Prozess',
  'status.index': 'Index-Prozess',
  'status.running': 'läuft',
  'status.down': 'nicht bereit',
  'status.versions': 'Versionen',
  'status.paths': 'Speicherorte',

  'index.paused': 'Inhaltsindex pausieren',
  'index.paused.hint':
    'Texterkennung und PDF-Auswertung stehen still. Der Schalter liegt auch im Tray.',
  'index.idle': 'Erst nach Inaktivität starten',
  'index.idle.hint': 'Sekunden ohne Eingabe, bevor der Index loslegt.',
  'index.battery': 'Auch im Akkubetrieb indizieren',
  'index.battery.hint': 'Aus, weil Texterkennung das Teuerste ist, was die App tut.',
  'index.concurrency': 'Gleichzeitige Jobs',

  'backup.enabled': 'Zeitgesteuert exportieren',
  'backup.enabled.hint':
    'Legt lesbare Dateien in einen Ordner, den dann restic, rsync oder ein Sync-Laufwerk abholt.',
  'backup.dir': 'Zielordner',
  'backup.every': 'Alle wie viel Stunden',
  'backup.formats': 'Formate',
  'backup.restore': 'Zurückspielen',
  'backup.restore.hint':
    'Eine Sicherung wird in dieser App geöffnet, nicht in WhatsApp. Ein Zurückspielen nach WhatsApp gibt es nicht — WhatsApp bietet dafür keinen Weg an.',

  'health.whatsapp-offline': 'WhatsApp Web ist nicht verbunden. Das Archiv wächst gerade nicht.',
  'health.phone-offline':
    'Dein Handy ist nicht erreichbar. Ältere Nachrichten lassen sich nicht nachladen.',
  'health.bridge-unavailable':
    'Die Verbindung zu WhatsApps Interna funktioniert nicht — vermutlich nach einem Update von WhatsApp Web. Das vorhandene Archiv bleibt durchsuchbar.',
  'health.archive-unavailable': 'Das Archiv ist nicht erreichbar. Suche und Export stehen still.',
  'health.archive-locked':
    'Das Archiv ist von einem anderen Vorgang gesperrt. Es wird nichts geschrieben, Lesen geht weiter.',
  'health.disk-full': 'Kein Platz mehr auf dem Datenträger. Es wird nichts mehr gespeichert.',
  'health.index-unavailable':
    'Der Inhaltsindex läuft nicht. Bilder und PDFs werden gerade nicht durchsucht.',
  'health.stillReadable': 'Nachrichten lesen und schreiben geht weiter wie immer.',

  'phase.notice':
    'Archiv und Suche folgen in den nächsten Phasen. Der Verlauf reicht dann ab dem Installationstag zurück — WhatsApp Web liefert rückwirkend höchstens 90 Tage.',
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
