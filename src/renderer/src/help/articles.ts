import {
  SEARCH_SYNTAX,
  type HelpArticle as SharedHelpArticle,
  type HelpBlock as SharedHelpBlock,
} from '@shared/help/content'

/**
 * The help inside the desktop app's panel: short articles, readable offline, in plain German.
 *
 * The panel explains itself in one sentence where something happens; everything beyond that
 * sentence is here, one click away — the "?" beside a settings section, "Mehr dazu" after a status
 * line, or the "Hilfe" tab. Each article answers what somebody asks at that moment and says what
 * to do when something goes wrong.
 *
 * It has to stay true as the application changes (CLAUDE.md, "Hilfe aktuell halten"):
 * - the search syntax, the status line, the banner's faults and the backfill's reasons are
 *   rendered from the data the panel itself shows (`generated` blocks, status-texts.ts);
 * - every label of this interface the text names is written `[[like this]]`, and
 *   test/unit/help.test.ts fails when the panel or the tray menu no longer has it.
 *
 * The browser extension has its own articles (src/extension/panel/help.ts) because its buttons
 * differ; the content model and the markup are shared (src/shared/help/content.ts).
 */

export type HelpTopic =
  | 'erste-schritte'
  | 'suchen'
  | 'archiv'
  | 'nachladen'
  | 'texterkennung'
  | 'dateien'
  | 'sicherung'
  | 'benachrichtigungen'
  | 'fenster'
  | 'darstellung'
  | 'konten'
  | 'sperre'
  | 'nummer'
  | 'updates'
  | 'speicher'
  | 'datenschutz'
  | 'probleme'
  | 'grenzen'

export type Generated = 'search-syntax' | 'mirror' | 'health' | 'backfill'

export type HelpBlock = SharedHelpBlock<Generated>
export type HelpArticle = SharedHelpArticle<HelpTopic, Generated>

export { SEARCH_SYNTAX }

export const HELP: readonly HelpArticle[] = [
  {
    id: 'erste-schritte',
    title: 'Erste Schritte',
    summary: 'Was WatIs? macht und wie das Archiv sich füllt.',
    body: [
      {
        p: 'WatIs? ist WhatsApp Web mit einem **durchsuchbaren Archiv auf deinem Rechner**. Links läuft WhatsApp wie gewohnt, rechts liegt dieses Panel mit [[Archiv]], [[Einstellungen]] und [[Hilfe]].',
      },
      {
        steps: [
          'Den **QR-Code** mit dem Handy scannen, wie bei WhatsApp Web. Danach nie wieder – die Anmeldung übersteht Neustarts und Updates.',
          'Oben unter [[Archiv]] steht dann [[Schreibt mit]]. Ab jetzt kommt jede neue Nachricht ins Archiv.',
          '[[Jetzt übernehmen]] holt einmalig herein, was WhatsApp Web schon geladen hat.',
        ],
      },
      {
        p: 'Wird eine Nachricht danach in WhatsApp gelöscht – von dir, vom Absender oder weil sie verschwindet –, behält dein Archiv sie. Was jemand **für alle** löscht, bleibt mit Text stehen und ist als „für alle gelöscht“ markiert.',
      },
      {
        list: [
          'Das Panel klappst du mit `Strg` + `,` ein und aus, oder über den Pfeil oben links. Eingeklappt bleibt rechts ein schmaler Streifen [[Archiv und Einstellungen]], der es wieder öffnet.',
          'Die Suche erreichst du jederzeit mit `Strg` + `K`.',
        ],
      },
      {
        note: 'Ältere Nachrichten, die WhatsApp Web nie geladen hat, kann WatIs? nur begrenzt nachholen – höchstens rund 90 Tage zurück. Der eigentliche Nutzen: Ab heute geht nichts mehr verloren.',
      },
    ],
    related: ['suchen', 'nachladen', 'probleme'],
  },
  {
    id: 'suchen',
    title: 'Suchen',
    summary: 'Über alle Chats auf einmal, auch in Bildern und PDFs.',
    body: [
      {
        p: 'Das Suchfeld oben unter [[Archiv]] sucht im **ganzen Archiv, über alle Chats**. Der links ausgewählte Chat schränkt nichts ein – nur `in:` tut das. Enter oder [[Suchen]] startet die Suche, `Esc` leert sie.',
      },
      {
        list: [
          'Groß- und Kleinschreibung ist egal. **Umlaute dürfen fehlen:** `Muenchen` findet „München“, `Gruesse` findet „Grüße“.',
          'Die Knöpfe [[Nachrichten]], [[Text in Bildern]], [[PDFs]] und [[Sprachnachrichten]] schreiben den passenden Filter ins Suchfeld. [[Filter zurücksetzen]] nimmt ihn wieder heraus.',
          'Über den Treffern stehen passende [[Chats und Kontakte]]. Ein Chat öffnet seinen Verlauf, ein Kontakt sucht nach allem, was er geschrieben hat.',
          '[[Stelle zeigen]] zeigt bei Bildern und PDFs den Ausschnitt, in dem der Text steht. [[Umgebung zeigen]] blendet die Nachrichten davor und danach ein.',
          '[[Erinnern]] an einem Treffer meldet sich [[in 3 Stunden]], [[morgen]] oder [[nächste Woche]] mit einer Benachrichtigung. Ein Klick darauf öffnet den Chat. Die Erinnerung bleibt auf deinem Rechner.',
        ],
      },
      { h: 'Gezielter suchen' },
      { p: 'Diese Zusätze lassen sich frei kombinieren:' },
      { generated: 'search-syntax' },
      {
        p: 'Beispiel: `Rechnung von:Anna nach:2026-01-01` findet Annas Nachrichten mit „Rechnung“ seit Jahresbeginn.',
      },
      {
        note: 'Text in Bildern und PDFs wird erst im Hintergrund erkannt. Findet die Suche dort noch nichts, steht unter [[Texterkennung]], wie viel noch wartet.',
      },
    ],
    related: ['texterkennung', 'archiv'],
  },
  {
    id: 'archiv',
    title: 'Chats und Galerie',
    summary: 'Ältere Nachrichten lesen, zu einem Datum springen, Dateien finden.',
    body: [
      {
        p: '[[Chats im Archiv]] listet alle Chats, die WatIs? mitgeschrieben hat, mit dem Datum der letzten Nachricht. Ein Klick auf die Überschrift klappt die Liste ein und aus, ein Klick auf einen Chat zeigt seinen [[Verlauf]].',
      },
      {
        list: [
          '[[Springe zu]] mit einem Datum und [[Los]] öffnet den Verlauf an diesem Tag.',
          'Hat jemand eine Nachricht **für alle** gelöscht, steht sie weiter mit Text da, mit dem Vermerk „für alle gelöscht“.',
          '[[Galerie]] zeigt die Dateien nach Art getrennt: [[Bilder]], [[Videos]], [[Dokumente]], [[Sprachnachrichten]] und [[Links]]. [[Ältere laden]] holt weiter zurückliegende.',
          '[[Öffnen]] öffnet eine Datei mit dem passenden Programm, [[Ordner]] zeigt sie im Dateimanager. Du kannst sie auch direkt aus der Galerie in einen Ordner oder eine Mail ziehen.',
        ],
      },
      {
        p: 'Steht bei einer Datei „Datei ist nicht im Archiv.“, hat WatIs? sie nicht geholt – etwa weil es ein Video ist. Mehr dazu unter „Dateien und Downloads“.',
      },
    ],
    related: ['suchen', 'dateien', 'nachladen'],
  },
  {
    id: 'nachladen',
    title: 'Ältere Nachrichten nachladen',
    summary: 'Was vor der Installation liegt, bis rund 90 Tage zurück.',
    body: [
      {
        p: 'Unten unter [[Archiv]] liegt eingeklappt [[Ältere Nachrichten nachladen]]. [[Starten]] öffnet jeden Chat der Reihe nach und bittet WhatsApp um ältere Nachrichten – so, wie du selbst nach oben scrollen würdest. Mit Pausen, damit es nach Mensch aussieht.',
      },
      {
        list: [
          '**Geöffnete Chats gelten danach als gelesen**, genauso, als hättest du sie angeklickt. Wer das nicht will, startet das Nachladen nicht.',
          'Benutzt du WhatsApp gerade, wartet das Nachladen, bis du fertig bist.',
          '[[Anhalten]] stoppt, und ein späteres [[Starten]] macht dort weiter – auch nach einem Neustart.',
          '[[Von vorn]] holt auch Chats noch einmal, die schon als fertig gelten. Was schon gespeichert ist, bleibt unangetastet.',
          '[[Erreichbar laut WhatsApp]] nennt das älteste Datum, das WhatsApp Web überhaupt herausgibt. Weiter zurück gibt es für Web-Clients nichts zu holen.',
        ],
      },
      { h: 'Wenn ein Chat nicht klappt' },
      { generated: 'backfill' },
    ],
    related: ['archiv', 'grenzen'],
  },
  {
    id: 'texterkennung',
    title: 'Texterkennung in Bildern und PDFs',
    summary: 'Wann Fotos und Dokumente durchsuchbar werden.',
    body: [
      {
        p: 'WatIs? liest Text aus Bildern, aus PDFs und aus eingescannten PDF-Seiten und macht ihn durchsuchbar. Das passiert auf deinem Rechner, im Hintergrund – Nachrichtentext dagegen ist sofort durchsuchbar.',
      },
      {
        list: [
          'Unter [[Archiv]] zeigt [[Texterkennung]], was schon fertig ist und was noch wartet.',
          'Unter [[Einstellungen]] → [[Inhaltsindex]]: [[Inhaltsindex pausieren]] hält alles an (geht auch im Tray). [[Erst nach Inaktivität starten]] legt fest, wie lange du nichts tun musst, bevor es losgeht. [[Auch im Akkubetrieb indizieren]] ist aus, weil Texterkennung das Teuerste ist, was WatIs? tut.',
          '[[Gleichzeitige Jobs]] beschleunigt die Erkennung, macht den Rechner dabei aber langsamer.',
        ],
      },
      {
        note: '**Sprachnachrichten** werden in der Desktop-App nicht in Text umgewandelt; der Filter [[Sprachnachrichten]] in der Suche findet dort deshalb nichts. In der Browser-Erweiterung geht das, auf Klick. Word-Dateien werden nirgends durchsucht.',
      },
    ],
    related: ['suchen', 'grenzen'],
  },
  {
    id: 'dateien',
    title: 'Dateien und Downloads',
    summary: 'Wohin Downloads gehen und welche Dateien das Archiv behält.',
    body: [
      {
        p: 'Lädst du in WhatsApp eine Datei herunter, fragt WatIs? nicht nach, sondern legt sie in den [[Zielordner]] unter [[Einstellungen]] → [[Dateien]]. Umlaute und Emoji im Namen bleiben erhalten.',
      },
      {
        list: [
          '[[Nach Chat in Unterordner sortieren]] legt jeden Chat in einen eigenen Ordner. Darunter steht, wie ein Dateiname dann aussieht.',
          '[[Nach dem Speichern melden]] zeigt eine Benachrichtigung zum Öffnen oder Anzeigen im Ordner.',
          'Dieselbe Datei zweimal geladen liegt nur einmal auf der Platte.',
        ],
      },
      { h: 'Was ins Archiv kommt' },
      {
        p: '**Bilder und Dokumente** holt WatIs? von selbst ins Archiv. **Sprachnachrichten und Videos nicht** – im Archiv steht dann der Eintrag ohne die Datei. Willst du eine behalten, lade sie in WhatsApp herunter; sie landet im Zielordner.',
      },
      {
        p: 'WhatsApp hält Dateien nur eine Zeit lang auf seinen Servern. Was nicht geholt wurde, ist später vielleicht nur noch auf dem Handy.',
      },
    ],
    related: ['archiv', 'speicher', 'sicherung'],
  },
  {
    id: 'sicherung',
    title: 'Export und Sicherung',
    summary: 'Das Archiv als lesbare Dateien in einen eigenen Ordner.',
    body: [
      {
        p: 'Unter [[Einstellungen]] → [[Export und Sicherung]] schreibt [[Zeitgesteuert exportieren]] jeden Chat als Datei in einen [[Zielordner]] deiner Wahl, mit den Anhängen, die im Archiv liegen. [[Alle wie viel Stunden]] legt fest, wie oft. Jedes Mal kommt nur dazu, was neu ist.',
      },
      {
        list: [
          'Den Ordner kann restic, rsync oder ein Sync-Laufwerk wie OneDrive oder Nextcloud abholen. WatIs? selbst spricht mit keiner Cloud.',
          'Unter [[Speicherplatz]] startet [[Jetzt exportieren]] sofort und zeigt, wann es zuletzt gelaufen ist.',
          'Die Dateien sind ohne WatIs? lesbar.',
        ],
      },
      {
        note: 'Ein Zurückspielen nach WhatsApp gibt es nicht – WhatsApp bietet dafür keinen Weg an.',
      },
    ],
    related: ['speicher', 'datenschutz'],
  },
  {
    id: 'benachrichtigungen',
    title: 'Benachrichtigungen und Ruhezeit',
    summary: 'Weniger Pings, und der Klick öffnet den richtigen Chat.',
    body: [
      {
        p: 'Ein Klick auf eine Benachrichtigung öffnet **den Chat**, nicht nur das Fenster. Unter [[Einstellungen]] → [[Benachrichtigungen]]:',
      },
      {
        list: [
          '[[Nicht melden, wenn der Chat schon offen ist]]: kein Ping für das, was du gerade liest.',
          '[[Bündelung]]: pro Chat eine Meldung in diesem Zeitfenster, danach eine Sammelmeldung – hilft bei vielen Gruppen.',
          '[[Auch stummgeschaltete Chats melden]]: sonst bleiben Chats, die du in WhatsApp stumm geschaltet hast, still.',
          '[[Ruhezeit]] mit Uhrzeit von und bis: in dieser Zeit keine Meldungen.',
        ],
      },
      {
        p: 'Im Tray-Menü schaltet [[Benachrichtigungen pausieren]] alles für den Moment ab. Das Tray-Symbol zeigt die Zahl der ungelesenen Nachrichten.',
      },
    ],
    related: ['fenster'],
  },
  {
    id: 'fenster',
    title: 'Fenster, Tray und Start',
    summary: 'Im Hintergrund weiterlaufen, mit dem Rechner starten.',
    body: [
      {
        list: [
          '[[Schließen minimiert in den Tray]]: Das Fenster verschwindet, WatIs? läuft weiter und meldet neue Nachrichten. Beenden geht dann über [[Beenden]] im Tray-Menü.',
          '[[Minimiert starten]] und [[Beim Anmelden starten]]: WatIs? startet mit dem Rechner, ohne sich nach vorn zu drängen.',
          '[[Globaler Schnellzugriff]] blendet das Fenster ein und aus, auch aus einer anderen App heraus. Voreingestellt ist `Strg` + `Umschalt` + `W`.',
        ],
      },
      {
        note: 'Unter **Linux mit GNOME, Unity oder Pantheon** gibt es keinen Tray. Dort beendet sich WatIs? beim Schließen des Fensters, statt unsichtbar weiterzulaufen.',
      },
    ],
    related: ['benachrichtigungen', 'grenzen'],
  },
  {
    id: 'darstellung',
    title: 'Darstellung und Eingabe',
    summary: 'Hell oder dunkel, kompakter, ruhiger, Enter für neue Zeilen.',
    body: [
      {
        list: [
          '[[Erscheinungsbild]]: [[Automatisch]] folgt dem System und wechselt mit. [[Hell]] und [[Dunkel]] bleiben fest.',
          '[[Kompaktmodus]] und [[Schriftgröße]] verändern WhatsApp selbst. [[Eigene CSS-Datei verwenden]] liest eine `user.css` aus dem Datenordner – für alle, die selbst gestalten wollen.',
          'Unter [[Entrümpeln]] lassen sich [[Kanäle ausblenden]], „Aktuelles“ und [[Meta AI ausblenden]]. Das blendet nur aus und entfernt nichts.',
          '[[Enter fügt einen Zeilenumbruch ein]]: gesendet wird dann mit `Strg` + `Enter`.',
          '[[Rechtschreibprüfung]] ist aus, bis du eine Sprache wählst. Unter Windows lädt Chromium dabei einmalig ein Wörterbuch von einem Google-Server – deshalb ist sie zunächst aus.',
          '[[Audioausgabe]] wählt den Lautsprecher für Sprachnachrichten und Videos.',
          'Im Bildbetrachter zoomt das Mausrad, Ziehen verschiebt.',
        ],
      },
    ],
    related: ['fenster'],
  },
  {
    id: 'konten',
    title: 'Mehrere Konten',
    summary: 'Privat und Arbeit nebeneinander, sauber getrennt.',
    body: [
      {
        p: 'Unter [[Einstellungen]] → [[Konten]] legt [[Hinzufügen]] ein weiteres WhatsApp-Konto an, bis zu fünf. Beim ersten Wechsel dorthin erscheint ein neuer QR-Code. Die Konten stehen dann als Reiter oben im Panel.',
      },
      {
        list: [
          'Jedes Konto hat eine eigene Anmeldung, ein eigenes Archiv und einen eigenen Medienordner.',
          'Alle laufen mit, auch im Hintergrund. Das kostet etwa so viel Speicher wie ein weiteres WhatsApp Web.',
          '**[[Entfernen]] löscht keine Daten**, es nimmt das Konto nur aus der Liste.',
        ],
      },
    ],
    related: ['sperre'],
  },
  {
    id: 'sperre',
    title: 'App-Sperre',
    summary: 'Eine PIN gegen den Blick über die Schulter.',
    body: [
      {
        p: 'Unter [[Einstellungen]] → [[App-Sperre]] eine PIN eintragen und [[Speichern]]. Ab dann fragt WatIs? beim Start danach, und nach der Zeit unter [[Nach Inaktivität sperren]]. [[Jetzt sperren]] sperrt sofort.',
      },
      {
        list: [
          'Verliert das Fenster den Fokus, wird es weichgezeichnet.',
          '[[Entfernen]] schaltet die Sperre wieder ab.',
        ],
      },
      {
        note: 'Die Sperre ist **Sichtschutz, keine Verschlüsselung**. Das Archiv liegt lesbar auf der Platte. Echten Schutz gibt die Laufwerksverschlüsselung des Systems (BitLocker, LUKS).',
      },
    ],
    related: ['datenschutz'],
  },
  {
    id: 'nummer',
    title: 'Chat mit Nummer',
    summary: 'Jemandem schreiben, ohne die Nummer zu speichern.',
    body: [
      {
        p: 'Unter [[Einstellungen]] → [[Chat mit Nummer]] eine Telefonnummer oder einen wa.me-Link eintragen und [[Chat öffnen]]. WhatsApp öffnet den Chat, ohne dass die Nummer im Adressbuch stehen muss.',
      },
      {
        p: '[[whatsapp://-Links übernehmen]] öffnet solche Links aus dem Browser oder aus Mails direkt in WatIs?. Unter Windows trägt sich WatIs? dafür in die Registry deines Benutzers ein – ohne Adminrechte.',
      },
    ],
  },
  {
    id: 'updates',
    title: 'Updates',
    summary: 'Neue Versionen kommen von selbst, installiert wird auf deinen Wunsch.',
    body: [
      {
        p: 'WatIs? sucht alle sechs Stunden auf GitHub nach einer neuen Version und lädt sie im Hintergrund. **Installiert wird erst, wenn du es sagst:** [[Jetzt neu starten]] oder [[Beim nächsten Beenden]].',
      },
      {
        list: [
          '[[Jetzt nach Updates suchen]] unter [[Einstellungen]] → [[Updates]] sucht sofort.',
          'Ohne [[Automatisch nach Updates suchen]] greift WatIs? für Updates auf gar nichts mehr zu.',
          'Updates brauchen keine Adminrechte. **Archiv, Mediendateien und Anmeldung bleiben unberührt.**',
          'Unter Linux gibt es Updates nur, wenn WatIs? als AppImage läuft.',
        ],
      },
    ],
    related: ['probleme'],
  },
  {
    id: 'speicher',
    title: 'Speicherplatz',
    summary: 'Was Platz braucht und was du gefahrlos löschen kannst.',
    body: [
      {
        p: 'Unter [[Einstellungen]] → [[Speicherplatz]] steht, was wie viel Platz braucht. Was nicht gelöscht werden darf, ist mit „Nicht löschbar.“ markiert.',
      },
      {
        list: [
          '[[Browser-Cache leeren]] gibt den Platz frei, der sich gefahrlos löschen lässt. **Anmeldung und Archiv bleiben unberührt.**',
          'Unter [[Mediendateien liegen hier]] kannst du die Medien auf ein anderes Laufwerk [[Verschieben]]. WatIs? kopiert und prüft erst, bevor am alten Ort etwas gelöscht wird. Die Datenbank bleibt, wo sie ist.',
          '[[Neu berechnen]] zählt noch einmal nach.',
        ],
      },
    ],
    related: ['dateien', 'sicherung'],
  },
  {
    id: 'datenschutz',
    title: 'Datenschutz und Sicherheit',
    summary: 'Was WatIs? tut und was nicht.',
    body: [
      {
        list: [
          '**Alles bleibt auf deinem Rechner.** Kein Konto, keine Cloud, keine Telemetrie, keine offenen Ports.',
          'Netzverkehr nur zu WhatsApp und zu GitHub für Updates. Die eine Ausnahme ist die [[Rechtschreibprüfung]], wenn du sie einschaltest.',
          'Texterkennung und PDF-Text rechnen auf deinem Rechner.',
          '**WatIs? liest nur mit.** Es schreibt nichts über WhatsApps interne Schnittstellen. Öffnet es einen Chat, weil du auf einen Treffer geklickt oder das Nachladen gestartet hast, markiert WhatsApp ihn als gelesen – wie bei einem eigenen Klick.',
          'Die Daten liegen unter Windows in `%LOCALAPPDATA%\\watis`, unter Linux in `~/.local/share/watis`. Wo genau, steht unter [[Einstellungen]] → [[Status]].',
        ],
      },
      {
        note: 'Das Archiv ist nicht verschlüsselt. Auf einem Firmenrechner kann die IT darauf zugreifen. Und es enthält Nachrichten anderer Leute – auch gelöschte und „verschwindende“, sobald sie einmal angekommen sind.',
      },
    ],
    related: ['sperre', 'grenzen'],
  },
  {
    id: 'probleme',
    title: 'Wenn etwas nicht geht',
    summary: 'Was die Meldungen bedeuten und was du tun kannst.',
    body: [
      { h: 'Die Zeile über dem Archiv' },
      { generated: 'mirror' },
      { h: 'Die Meldung ganz oben' },
      {
        p: 'Geht etwas kaputt, steht oben im Panel eine Zeile. Sie verschwindet von selbst, sobald es wieder geht. WhatsApp lesen und schreiben geht in jedem Fall weiter.',
      },
      { generated: 'health' },
      { h: 'Sonstiges' },
      {
        list: [
          '**Das Archiv bleibt leer:** Steht oben [[Schreibt mit]], kommen neue Nachrichten von selbst. [[Jetzt übernehmen]] holt sofort, was WhatsApp Web schon geladen hat.',
          '**Die Suche findet ein Foto nicht:** Die Texterkennung ist vielleicht noch nicht durch. Siehe [[Texterkennung]] unter [[Archiv]].',
          '**Windows startet WatIs? nicht:** Bei einer SmartScreen-Warnung auf „Weitere Informationen“ und „Trotzdem ausführen“ klicken. Fehlt dieser Weiterklick, blockiert die Intelligente App-Steuerung; dann bleibt die Browser-Erweiterung.',
          '**Unter Linux startet das AppImage nicht** und meldet `libfuse.so.2`: mit `--appimage-extract-and-run` starten.',
          '**Etwas anderes:** unter [[Einstellungen]] → [[Status]] stehen die Versionen. Bitte mit diesen auf GitHub melden.',
        ],
      },
    ],
    related: ['updates', 'grenzen'],
  },
  {
    id: 'grenzen',
    title: 'Was WatIs? nicht kann',
    summary: 'Ehrlich vorab.',
    body: [
      {
        list: [
          '**Nachrichten von vor der Installation** gibt es nur so weit, wie WhatsApp Web sie herausgibt – höchstens rund 90 Tage zurück.',
          '**Sprachnachrichten und Videos** holt die Desktop-App nicht ins Archiv, und Sprachnachrichten werden hier nicht in Text umgewandelt. Die Browser-Erweiterung kann beides.',
          '**Word-Dateien** werden nicht durchsucht.',
          '**Zurück nach WhatsApp** spielt WatIs? nichts. Das Archiv ist eine Kopie für dich.',
          '**Nach Relevanz sortiert** braucht die Suche bei sehr häufigen Wörtern länger. Zeitlich sortiert bleibt sie schnell.',
          '**Dein WhatsApp-Konto:** WhatsApps Bedingungen untersagen inoffizielle Clients. WatIs? liest nur und drosselt das Nachladen, aber eine Garantie gegen eine Sperre ist das nicht.',
          '**Wenn WhatsApp sich ändert**, kann ein Teil von WatIs? aussetzen, bis ein Update kommt. Das Archiv bleibt dabei lesbar und durchsuchbar.',
        ],
      },
    ],
    related: ['datenschutz', 'probleme'],
  },
]

export function helpArticle(id: HelpTopic): HelpArticle {
  const article = HELP.find((a) => a.id === id)
  if (!article) throw new Error(`no help article ${id}`)
  return article
}
