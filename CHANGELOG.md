# Changelog

Nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung nach
[SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

Es gibt noch kein Release. Der Stand pro Phase steht in [`PLAN.md`](PLAN.md); hier stehen die
Änderungen, die für Nutzerinnen sichtbar wären.

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
- Nutzdaten nur unter `%LOCALAPPDATA%\watis\`. Keine Adminrechte, keine Dienste, keine offenen Ports.

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
