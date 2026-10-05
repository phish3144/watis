# Changelog

Nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Hinzugefügt

- **WatIs? im Browser**: als Erweiterung für Chrome, Edge und Firefox, ohne Installation auf dem
  Rechner und ohne Adminrechte ([ADR 0010](docs/decisions/0010-browser-erweiterung.md)). Sie nutzt
  dieselbe read-only Bridge, dasselbe Archiv auf SQLite (hier als WASM im privaten Speicher der
  Erweiterung) und dieselbe Suche wie die Desktop-App. Dazu kommen Badge und Benachrichtigungen mit
  Bündelung und Ruhezeit.
- **Neu gestaltete Oberfläche** im Browser: Suche, Chats, Medien, Einstellungen. Schmal neben
  WhatsApp, breit als eigener Tab. Treffer nennen Chat und Absender statt Telefonnummern.
- **Texterkennung und PDF-Text im Browser**, auch für eingescannte PDFs. Alles im Paket, nichts aus
  dem Netz.
- **Sprachnachrichten transkribieren**, mit einem Klick auf „Transkribieren“ unter der
  Sprachnachricht, mit whisper.cpp lokal im Browser. Eine Sprachnachricht, die noch nicht im Archiv
  ist, wird dabei geholt. Beim ersten Mal bietet der Knopf das Sprachmodell an (57 MB, „Genau“ mit
  181 MB in den Einstellungen) und lädt es erst nach einem zweiten Klick, geprüft gegen eine
  Prüfsumme, oder von der Platte, wenn GitHub gesperrt ist. Das Transkript ist sofort durchsuchbar.
  Die Sprache ist einstellbar, Deutsch voreingestellt
  ([ADR 0012](docs/decisions/0012-ocr-und-transkription-im-browser.md)).
- **Medien dauerhaft sichern**: Abrufregeln für Bilder, Dokumente, Sprachnachrichten und Videos als
  Einstellung. Die Sicherung des Browser-Archivs geht in einen gewählten Ordner (Chrome, Edge), der
  auch ein OneDrive- oder Nextcloud-Ordner sein darf, oder als ZIP. Sie hat dasselbe Format wie die
  Sicherung der Desktop-App, und jedes Mal kommt nur Neues dazu
  ([ADR 0011](docs/decisions/0011-medien-dauerhaft-sichern.md)).

- **Sicherung zurückspielen** in der Browser-Erweiterung: aus dem Sicherungsordner oder aus allen
  ZIP-Sicherungen zusammen, auch eine Sicherung der Desktop-App. Damit kommt das Archiv nach dem
  Entfernen der Erweiterung, in einem neuen Browserprofil oder beim Wechsel auf eine andere Fassung
  zurück ([ADR 0011](docs/decisions/0011-medien-dauerhaft-sichern.md)).
- **Hilfe eingebaut**, in der Desktop-App und in der Browser-Erweiterung: ein Reiter **Hilfe** mit
  kurzen Artikeln, die ohne Netz funktionieren, ein **?** neben jedem Abschnitt der Einstellungen
  und **Mehr dazu** an den Statuszeilen. Die Meldung oben im Panel sagt jetzt auch, was zu tun ist.
  Im Browser erklärt das Panel außerdem auf Deutsch, warum eine Datei nicht ins Archiv kam.

### Geändert

- **Für alle gelöschte Nachrichten bleiben im Archiv**, mit Text und Anhang, als „für alle gelöscht"
  markiert und weiter in der Suche. Das gilt für Nachrichten, die WatIs? vor dem Löschen schon
  mitgeschrieben hatte, auch im Export
  ([ADR 0013](docs/decisions/0013-geloeschte-nachrichten-bleiben.md)).

### Behoben

- **Ein Backfill konnte eine gelöschte Nachricht als nicht gelöscht zurückschreiben**, wenn er eine
  ältere Fassung nachlieferte. Die Markierung bleibt jetzt in jedem Fall.
- **Anhänge wurden nie ins Archiv geholt.** Die Bridge legte für Anhänge keine Medienzeile an, und
  der Medienabruf fand deshalb nie etwas zu tun, im Desktop wie im Browser. Jetzt entsteht für jede
  Nachricht mit Anhang eine Zeile, live wie beim Übernehmen.

## [0.7.1] — 2026-09-13

- **Linux (Ubuntu und andere)** als zweite Plattform, seit 0.7.0: ein AppImage, ohne `sudo`, ohne
  Paketmanager. Die App trägt sich beim ersten Start selbst in den Desktop ein und erkennt, dass
  GNOME keine Tray-Icons mehr zeigt ([ADR 0009](docs/decisions/0009-linux-appimage-und-gnome.md)).
- Ein fehlgeschlagener Update-Versuch meldete sich zweimal, einmal davon als unbehandelte
  Ausnahme im Fehlerprotokoll. Beide Wege werden jetzt behandelt.

Ältere Versionen sind unter [Releases](https://github.com/phish3144/watis/releases) aufgeführt.
Der Stand pro Phase steht in [`PLAN.md`](PLAN.md); darunter stehen die Änderungen, die für
Nutzerinnen sichtbar sind.

### Hinzugefügt

- **Archiv und Suche.** SQLite mit FTS5, deutsche Normalisierung (`Grüße` findet `Gruesse`),
  Suchsyntax mit `von:`, `in:`, `vor:`, `nach:`, `hat:` und `quelle:` — deutsche wie englische
  Feldnamen. Virtualisierte Listen, Keyset-Paging, Datumssprung, Medien-Galerie.
- **Treffer mit Vorschau.** Ein Treffer zeigt die getroffene Zeile und wo sie steht: Seite beim PDF,
  Zeitmarke beim Audio, Bildausschnitt und Confidence bei der Texterkennung.
- **Live-Spiegel.** Read-only-Bridge in WhatsApp Webs Seitenwelt, gebündelt und über einen
  Ringpuffer in den Archiv-Prozess. Rückstau und Verworfenes stehen im Panel.
- **Nachladen älterer Nachrichten**, gedrosselt, fortsetzbar, nur auf ausdrücklichen Start —
  Chats öffnen markiert sie als gelesen ([ADR 0006](docs/decisions/0006-lesebestaetigung-beim-chatoeffnen.md)).
- **Inhaltsindex.** Texterkennung (tesseract) und PDF-Text (pdf.js), lokal, nur im Leerlauf und am
  Netzstrom, über den Tray pausierbar.
- **Dateien.** Downloads ohne Dialog in eine feste Ordnerstruktur, SHA-256-Dedupe, Toast mit
  „Öffnen" und „Im Ordner zeigen", Drag-out aus der Galerie.
- **Export und Sicherung.** JSON, HTML, TXT pro Chat; Sicherung mit Datenbank, Medien und einem
  Bericht darüber, was **nicht** drin ist. Zeitgesteuert in einen Ordner für restic oder rsync.
- **Desktop.** Tray mit Badge, Benachrichtigungen mit Bündelung und Ruhezeit, globaler Shortcut,
  Autostart, Kompaktmodus, eigene CSS-Datei, Declutter-Schalter, Enter/Shift+Enter, Zoom im
  Bildbetrachter, wählbare Audioausgabe, Rechtschreibprüfung.
- **Mehrere Konten** mit getrennten Anmeldungen, Archiven und Medienordnern; jedes läuft mit, auch
  im Hintergrund. Entfernen nimmt ein Konto aus der Liste und löscht keine Daten.
- **App-Sperre** mit PIN und Weichzeichnen bei Fokusverlust — ausdrücklich Sichtschutz, keine
  Verschlüsselung.
- **Erinnerungen** an einzelne Nachrichten, rein lokal.
- **Chat mit Nummer** ohne den Kontakt zu speichern; `whatsapp://`-Links optional übernommen.
- **Gescannte PDF-Seiten** werden gerendert und erkannt — und nur die, die keine Textebene haben.
- **Speicher-Übersicht** mit dem, was gelöscht werden darf — und dem, was nicht. Der Medienordner
  lässt sich auf ein anderes Laufwerk verschieben; die Datenbank bleibt, wo sie ist.
- **Auto-Update** über GitHub Releases, per-user, ohne Adminrechte.

### Sicherheit und Datenschutz

- Kein Telemetrie-, Crash- oder Cloud-Verkehr. Netzverkehr nur zu WhatsApp und GitHub Releases.
- Die Bridge ist read-only. Kein Senden, kein Löschen, kein Markieren ohne Nutzerhandlung.
- Nutzdaten nur unter `%LOCALAPPDATA%\watis\` beziehungsweise `~/.local/share/watis/`. Keine
  Adminrechte, keine Dienste, keine offenen Ports.

### Bekannte Einschränkungen

- **Rückwirkend gibt es höchstens rund 90 Tage.** Mehr gibt WhatsApp Web nicht her
  ([`docs/backfill-findings.md`](docs/backfill-findings.md)).
- Die Relevanzsortierung der Suche verfehlt das 200-ms-Gate bei sehr häufigen Begriffen —
  bauartbedingt ([ADR 0007](docs/decisions/0007-suchreihenfolge-und-zeitgeordnete-rowid.md)).
- Sprachnachrichten werden noch nicht transkribiert; die Jobs entstehen und werden übersprungen
  ([ADR 0008](docs/decisions/0008-ocr-und-pdf-engines.md)).
- Das Medienholen hängt an einer WhatsApp-Web-Signatur, die als einzige im Projekt **nicht** gegen
  ein laufendes Bundle geprüft ist. Löst sie nicht auf, schaltet sich das Medienholen ab und der
  Rest läuft weiter ([`docs/bridge-smoke.md`](docs/bridge-smoke.md)).
- Das Archiv liegt unverschlüsselt auf der Platte; der Schutz kommt von BitLocker oder FileVault.
  Die App-Sperre ändert daran nichts.
- Ein Chat-Screenshot mit heller Schrift auf der grünen Sprechblase wird von der Texterkennung
  teilweise **nicht** gelesen; festgehalten in `test/integration/ocr-fixtures.test.ts`.
- DOCX wird noch nicht ausgewertet — die dafür nötige Bibliothek ist nicht freigegeben.
