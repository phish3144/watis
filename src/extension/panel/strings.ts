/**
 * Every word the panel shows, in one place (CLAUDE.md: UI German, i18n-capable from the start).
 *
 * A key per sentence rather than per word: German word order does not survive concatenation, so a
 * phrase with a number in it is one entry with a `{n}` placeholder.
 */

const de = {
  'app.name': 'WatIs?',
  'app.openLarge': 'Im großen Fenster öffnen',

  'nav.search': 'Suche',
  'nav.chats': 'Chats',
  'nav.media': 'Medien',
  'nav.settings': 'Mehr',
  'nav.settings.long': 'Einstellungen',
  'nav.help': 'Hilfe',

  'help.title': 'Hilfe',
  'help.intro':
    'Kurz erklärt, was WatIs? macht und wie du es bedienst. Alles hier funktioniert auch ohne Internet.',
  'help.back': 'Alle Themen',
  'help.related': 'Passt dazu',
  'help.more': 'Mehr dazu',
  'help.open': 'Hilfe: {topic}',
  'help.howto': 'So geht’s',

  'status.archiving': 'Archiv läuft',
  'status.noTab': 'WhatsApp ist nicht offen',
  'status.waiting': 'Wartet auf WhatsApp',
  'status.problem': 'Störung',
  'status.archiving.explain': 'Alles in Ordnung: Neue Nachrichten kommen ins Archiv.',
  'status.noTab.explain':
    'WhatsApp Web in einem Tab öffnen, damit mitgeschrieben wird. Suchen geht trotzdem.',
  'status.waiting.explain':
    'WhatsApp Web lädt noch oder ist nicht angemeldet. Anmelden und kurz warten.',
  'status.problem.explain':
    'Etwas hakt – unten steht, was. Hilft das nicht, den WhatsApp-Tab neu laden.',
  'status.title': 'Zustand',
  'status.bridge': 'Verbindung zu WhatsApp Web',
  'status.bridge.ok': 'verbunden',
  'status.bridge.waiting': 'noch nicht – angemeldet und Chats geladen?',
  'status.bridge.none': 'kein WhatsApp-Tab offen',
  'status.archive': 'Archiv',
  'status.archive.tab': 'geöffnet im WhatsApp-Tab',
  'status.archive.panel': 'geöffnet hier im Panel',
  'status.archive.none': 'nicht geöffnet',
  'status.written': 'Mitgeschrieben',
  'status.queued': 'Wartet',
  'status.dropped': 'Verworfen',
  'status.media': 'Medien',
  'status.media.detail': '{fetched} geholt · {skipped} übersprungen · {failed} Fehler',
  'status.openWhatsApp': 'WhatsApp Web öffnen',
  'status.close': 'Schließen',
  'status.counts': '{messages} Nachrichten · {chats} Chats · {media} Medien',

  'search.placeholder': 'In allen Chats suchen …',
  'search.clear': 'Suche leeren',
  'search.filter.all': 'Alles',
  'search.filter.body': 'Nachrichten',
  'search.filter.ocr': 'Text in Bildern',
  'search.filter.pdf': 'PDFs',
  'search.filter.transcript': 'Sprachnachrichten',
  'search.filter.file': 'Dateien',
  'search.empty.title': 'Was suchst du?',
  'search.empty.body':
    'Durchsucht wird alles, was seit der Installation mitgeschrieben wurde – Nachrichten, Dateinamen und erkannter Text aus Bildern und PDFs.',
  'search.tips': 'Suchtipps',
  'search.none': 'Nichts gefunden.',
  'search.none.hint': 'Umlaute dürfen fehlen: „Muenchen" findet „München".',
  'search.names': 'Chats und Kontakte',
  'search.name.chat': 'Chat',
  'search.name.contact': 'Kontakt',
  'search.messages': 'Nachrichten',
  'search.more': 'Weitere Treffer laden',
  'search.preview': 'Treffer im Zusammenhang',
  'search.preview.hint': 'Wähle links einen Treffer – hier erscheint der Verlauf drumherum.',
  'search.openInWhatsApp': 'In WhatsApp öffnen',
  'search.showInChat': 'Im Verlauf zeigen',

  'source.body': 'Nachricht',
  'source.filename': 'Dateiname',
  'source.ocr': 'Text im Bild',
  'source.pdf': 'PDF',
  'source.docx': 'Dokument',
  'source.text': 'Textdatei',
  'source.transcript': 'Sprachnachricht',
  'source.page': 'S. {n}',

  'chats.filter': 'Chat suchen',
  'chats.empty':
    'Noch keine Chats im Archiv. Sobald WhatsApp Web offen und angemeldet ist, füllt es sich von selbst.',
  'chats.group': 'Gruppe',
  'chats.pick': 'Wähle links einen Chat',
  'chats.pick.hint':
    'Der Verlauf kommt aus dem Archiv und reicht so weit zurück, wie mitgeschrieben wurde.',
  'chat.back': 'Zurück',
  'chat.jump': 'Zu Datum springen',
  'chat.older': 'Ältere laden',
  'chat.beginning': 'Anfang des Archivs für diesen Chat',
  'chat.you': 'Du',
  'chat.edited': 'bearbeitet',
  'chat.revoked': 'Diese Nachricht wurde gelöscht.',
  'chat.attachment.image': 'Bild',
  'chat.attachment.video': 'Video',
  'chat.attachment.audio': 'Sprachnachricht',
  'chat.attachment.file': 'Datei',

  'media.images': 'Bilder',
  'media.videos': 'Videos',
  'media.documents': 'Dokumente',
  'media.audio': 'Sprache',
  'media.links': 'Links',
  'media.empty':
    'Hier erscheinen Bilder, Videos, Dokumente und Sprachnachrichten, sobald sie in einem Chat ankommen.',
  'media.problem.details': 'Technische Angabe: {raw}',
  'media.fetch': 'Laden',
  'media.fetching': 'Wird geladen …',
  'media.notFetched': 'Noch nicht im Archiv',
  'media.save': 'Speichern',
  'media.open': 'Öffnen',
  'media.more': 'Ältere laden',
  'media.transcribe': 'Transkribieren',
  'media.transcribing': 'Wird transkribiert …',
  'media.transcribing.percent': 'Wird transkribiert … {percent} %',
  'media.transcript': 'Transkript',
  'media.transcript.empty': 'Darin war nichts zu verstehen.',

  'settings.archive': 'Archiv und Sicherung',
  'settings.archive.hint':
    'Das Archiv liegt nur in diesem Browserprofil. Wird die Erweiterung entfernt, ist es weg – eine Sicherung als Datei überlebt das.',
  'backup.folder': 'Sicherungsordner',
  'backup.folder.none':
    'Noch keiner gewählt. Gut geeignet: ein Ordner, den OneDrive, Nextcloud oder ein Laufwerk der Firma abgleicht.',
  'backup.folder.never': '„{name}“ · noch nie gesichert',
  'backup.folder.last': '„{name}“ · zuletzt {when}',
  'backup.folder.choose': 'Ordner wählen …',
  'backup.folder.change': 'Ändern …',
  'backup.now': 'Jetzt sichern',
  'backup.zip': 'Als ZIP herunterladen',
  'backup.zip.first': 'Die ZIP-Sicherung enthält das Archiv und alle Medien.',
  'backup.zip.since':
    'Die ZIP-Sicherung enthält das Archiv und die Medien seit der letzten ZIP-Sicherung ({when}).',
  'backup.zip.full': 'Alle Medien neu',
  'backup.running': 'Wird gesichert … {files} Dateien, {bytes}',
  'backup.done.folder': 'Gesichert: {copied} neue Dateien, {kept} waren schon da.',
  'backup.done.zip': 'Im Download-Ordner: {parts} · {copied} Medien',
  'backup.error.noFolderAccess':
    'Dieser Browser erlaubt Erweiterungen keinen Ordnerzugriff – bitte als ZIP sichern.',
  'backup.error.noFolder': 'Erst einen Sicherungsordner wählen.',
  'backup.error.permission': 'Ohne Schreibrecht für den Ordner geht es nicht.',
  'backup.error.download': 'Download abgebrochen: {error}',
  'settings.storage': 'Belegt: {used} von {limit}',
  'settings.quota': 'Speichergrenze',

  'settings.media': 'Medien automatisch sichern',
  'settings.media.hint':
    'WhatsApp hält Medien nur begrenzt auf seinen Servern bereit. Was nicht bald nach dem Eintreffen geholt wird, ist später womöglich nicht mehr zu bekommen.',
  'settings.media.images': 'Bilder',
  'settings.media.documents': 'Dokumente',
  'settings.media.voice': 'Sprachnachrichten',
  'settings.media.voice.hint': 'Klein (rund 100 KB pro Minute), aber sonst nur auf Klick.',
  'settings.media.videos': 'Videos bis',
  'settings.media.videos.off': 'nur auf Klick',

  'settings.index': 'Texterkennung und Transkription',
  'settings.index.ocr': 'Text in Bildern und PDFs erkennen',
  'settings.index.ocr.hint':
    'Läuft lokal, eine Datei nach der anderen. Nichts verlässt den Rechner.',
  'settings.index.transcription': 'Sprachnachrichten transkribieren',
  'settings.index.transcription.hint':
    'Auf Klick an einer Sprachnachricht. Braucht einmalig ein Sprachmodell, das du hier herunterlädst.',
  'transcription.unsupported':
    'Geht in diesem Browser nicht: Whisper braucht geteilten Speicher, den er Erweiterungen nicht gibt. In Chrome, Edge und Firefox geht es.',
  'transcription.model.base': 'Schnell',
  'transcription.model.base.hint': 'Für klare Aufnahmen · {size}',
  'transcription.model.small': 'Genau',
  'transcription.model.small.hint': 'Auch bei Dialekt und Nebengeräuschen · {size}',
  'transcription.download': 'Herunterladen',
  'transcription.remove': 'Entfernen',
  'transcription.ready': 'Bereit',
  'transcription.checking': 'Wird geprüft …',
  'transcription.language': 'Sprache der Sprachnachrichten',
  'transcription.language.auto.hint':
    'Erkennen kostet einen zweiten Durchgang – dauert doppelt so lang.',
  'transcription.language.auto': 'Automatisch erkennen',
  'transcription.language.de': 'Deutsch',
  'transcription.language.en': 'Englisch',
  'transcription.language.tr': 'Türkisch',
  'transcription.language.pl': 'Polnisch',
  'transcription.language.ru': 'Russisch',
  'transcription.language.uk': 'Ukrainisch',
  'transcription.language.ar': 'Arabisch',
  'transcription.language.it': 'Italienisch',
  'transcription.language.es': 'Spanisch',
  'transcription.language.fr': 'Französisch',
  'transcription.fromFile': 'Modell aus einer Datei',
  'transcription.fromFile.pick': 'Datei wählen …',
  'transcription.fromFile.hint':
    'Falls GitHub im Firmennetz gesperrt ist: dieselbe Datei von woanders, geprüft gegen dieselbe Prüfsumme.',
  'transcription.imported': 'Modell übernommen.',
  'transcription.needModel': 'Erst unter Einstellungen ein Sprachmodell laden.',
  'transcription.needTab': 'In Firefox transkribiert der WhatsApp-Tab – bitte WhatsApp Web öffnen.',
  'transcription.firefox': 'In Firefox rechnet der WhatsApp-Tab – er muss dafür offen sein.',
  'transcription.error.permission': 'Ohne Erlaubnis für den Download von GitHub geht es nicht.',
  'transcription.error.download': 'Download fehlgeschlagen ({status}).',
  'transcription.error.storage': 'Kein Speicherplatz für das Modell verfügbar.',
  'transcription.error.checksum': 'Das Modell stimmt nicht mit der hinterlegten Prüfsumme überein.',
  'transcription.error.unknownFile': 'Diese Datei ist keines der unterstützten Sprachmodelle.',
  'transcription.error.audio': 'Die Sprachnachricht ließ sich nicht lesen.',

  'settings.notifications': 'Benachrichtigungen',
  'settings.notifications.enabled': 'Benachrichtigungen zeigen',
  'settings.notifications.visible': 'Nicht für den Chat, der gerade offen ist',
  'settings.notifications.coalesce': 'Bündeln innerhalb von',
  'settings.notifications.dnd': 'Ruhezeit',

  'settings.whatsapp': 'WhatsApp Web aufräumen',
  'settings.whatsapp.compact': 'Kompakte Darstellung',
  'settings.whatsapp.font': 'Schriftgröße',
  'settings.whatsapp.channels': 'Kanäle ausblenden',
  'settings.whatsapp.status': 'Status ausblenden',
  'settings.whatsapp.metaAi': 'Meta AI ausblenden',
  'settings.whatsapp.enter': 'Enter macht einen Zeilenumbruch, Strg+Enter sendet',

  'settings.panel': 'Darstellung',
  'settings.theme.system': 'Wie das System',
  'settings.theme.light': 'Hell',
  'settings.theme.dark': 'Dunkel',

  'settings.about': 'Über WatIs?',
  'settings.about.local':
    'Alles läuft lokal. Keine Telemetrie, keine Cloud, kein Konto. Das Archiv verlässt diesen Rechner nur über eine Sicherung, die du selbst anstößt – wohin, bestimmst du.',
  'settings.about.notOfficial':
    'Kein offizielles WhatsApp-Produkt, keine Verbindung zu Meta. WhatsApp ist eine Marke von Meta Platforms, Inc.',
  'settings.about.version': 'Version {version}',

  'welcome.title': 'Willkommen bei WatIs?',
  'welcome.body':
    'WatIs? schreibt mit, was in WhatsApp Web passiert, und macht es durchsuchbar – auch Text in Bildern und PDFs. Alles bleibt in diesem Browser.',
  'welcome.step1': 'WhatsApp Web öffnen und wie gewohnt anmelden.',
  'welcome.step2': 'Das Archiv füllt sich von selbst, solange der Tab offen ist.',
  'welcome.step3': 'Über das WatIs?-Symbol in der Symbolleiste suchen.',
  'welcome.permission': 'Firefox braucht noch deine Erlaubnis für web.whatsapp.com.',
  'welcome.grant': 'Erlauben',
  'welcome.dismiss': 'Verstanden',
  'welcome.guide': 'Kurze Einführung lesen',

  'common.error': 'Das hat nicht geklappt: {error}',
  'common.loading': 'Lädt …',
  'common.today': 'heute',
  'common.yesterday': 'gestern',
} as const

export type StringKey = keyof typeof de

/** Every label, for checking that the help names only labels that exist (test/unit/help.test.ts). */
export const LABELS: readonly string[] = Object.values(de)

export function t(key: StringKey, vars?: Record<string, string | number>): string {
  let text: string = de[key]
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}
