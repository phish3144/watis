# WatIs?

Ein Desktop-Client für WhatsApp Web mit lokalem Archiv, Volltextsuche und ordentlicher
Desktop-Integration. Für Windows 10/11; macOS wird mitgebaut.

> **Status: in Entwicklung.** Es gibt noch kein benutzbares Release. Der verbindliche Plan steht in
> [`PLAN.md`](PLAN.md), die getroffenen Entscheidungen in [`docs/decisions/`](docs/decisions/).

## Was es macht

- Hostet `web.whatsapp.com` in Electron mit persistenter Session – kein erneutes QR-Scannen nach Updates
- Spiegelt Nachrichten, Chats und Medien in eine lokale SQLite-Datenbank mit Volltextsuche
- Schreibt ab dem Installationstag lückenlos mit und nimmt beim Verknüpfen mit, was WhatsApp Web
  hergibt – das sind rund 90 Tage, mehr gibt der Web-Client nicht her
- Speichert Dateien ohne Dialog in eine feste Ordnerstruktur
- Macht Text in Bildern (OCR), in PDFs – auch eingescannten – und, auf Anforderung, in Sprachnachrichten
  durchsuchbar
- Tray, Badge, native Benachrichtigungen, Autostart, Shortcuts, Themes, Declutter-Schalter
- Exportiert alles in offene Formate (JSON, HTML, TXT)

Alles läuft lokal. Keine Telemetrie, keine Cloud, keine Accounts, keine laufenden Kosten.

## Was es bewusst nicht macht

- **Kein Protokoll-Client.** Alles läuft über den offiziellen Web-Client.
- **Keine Sende-Automatisierung.** Kein Scheduling, keine Bots, kein Bulk, kein Auto-Reply.
- **Kein Schreiben oder Löschen** über die internen Schnittstellen von WhatsApp Web. Die Bridge ist strikt
  read-only.
- **Nichts, was Adminrechte braucht.** Keine Dienste, keine HKLM-Registry, keine offenen Ports.

## Quick Start (unter 5 Minuten)

Voraussetzung: Node 22 oder neuer und Git. Sonst nichts — kein Compiler, keine Adminrechte, kein
Python. `better-sqlite3` kommt als vorgebautes Node-API-Binary, es wird nichts nachgebaut.

```bash
git clone https://github.com/phish3144/watis.git
cd watis
npm ci
npm run dev
```

Beim ersten Start erscheint der QR-Code von WhatsApp Web. Einmal scannen — die Sitzung liegt danach
in `%LOCALAPPDATA%\watis\session\` und überlebt Neustarts und Updates.

Rechts liegt das eigene Panel (**Strg + ,** blendet es ein und aus) mit Archivansicht, Suche und
allen Schaltern. Das Archiv füllt sich, sobald die Bridge steht; **Jetzt übernehmen** holt in einem
Zug, was WhatsApp Web bereits im Speicher hat.

### Nützliche Kommandos

|                        |                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Entwicklungsmodus mit Hot Reload                                                                  |
| `npm run verify`       | Format, Lint, Typen, Unit- und Integrationstests — Sekunden                                       |
| `npm run test:e2e`     | Playwright gegen die echte Electron-App                                                           |
| `npm run gate:release` | Alles davon plus Lasttest ([`docs/lasttest.md`](docs/lasttest.md))                                |
| `npm run dist:win`     | Per-User-Installer, ohne Adminrechte ([`docs/managed-deployment.md`](docs/managed-deployment.md)) |

### Wo die Daten liegen

Alles unter `%LOCALAPPDATA%\watis\` (macOS: `~/Library/Application Support/watis/`), nie im
Roaming-Profil:

```
session/   die WhatsApp-Web-Sitzung — wird nie gelöscht, nur der Cache selektiv
archive/   archive.sqlite mit Nachrichten und Volltextindex
blobs/     Mediendateien, inhaltsadressiert und dedupliziert
logs/      Protokolle
```

Sichern und Zurückspielen: [`docs/backup-und-restore.md`](docs/backup-und-restore.md).
Wie das Ganze aufgebaut ist: [`docs/architecture.md`](docs/architecture.md).

## Ehrliche Hinweise

- Dies ist **kein offizielles WhatsApp-Produkt** und steht in keiner Verbindung zu Meta. WhatsApp ist eine
  Marke von Meta Platforms, Inc.
- Der Client hängt an internen Strukturen von WhatsApp Web. Ein WhatsApp-Update kann Teile davon jederzeit
  brechen. Die App ist so gebaut, dass sie dann degradiert statt abzustürzen – aber sie tut es.
- **Rückwirkend gibt es nichts zu holen.** WhatsApp Web liefert höchstens etwa 90 Tage Historie; einen
  Massenabruf gibt es für Web-Clients nicht. Was vor der Installation liegt, bleibt draußen. Der Nutzen
  liegt darin, dass ab dem Installationstag nichts mehr verschwindet – kein 90-Tage-Fenster, kein
  „Nutze dein Telefon für ältere Nachrichten". Die Messung dazu steht in
  [`docs/backfill-findings.md`](docs/backfill-findings.md).
- Das Archiv liegt **unverschlüsselt** auf der Platte. Der Schutz kommt von der Laufwerksverschlüsselung
  des Betriebssystems (BitLocker, FileVault). Wer das nicht hat, sollte es einschalten.
- Das Archiv enthält Nachrichten anderer Leute, auch gelöschte und **auch verschwindende**, sobald sie
  einmal gespiegelt wurden. Bei einer verschwindenden Nachricht war die Befristung von Anfang an die
  Bedingung, unter der sie geschickt wurde – dieses Archiv hält sie trotzdem. Das ist eine bewusste
  Entscheidung und je nach Umfeld und Rechtslage eine, die man treffen muss, nicht eine, die einem
  passiert.
- Läuft die App auf einem **verwalteten Firmengerät**, liegt das Archiv auf fremder Infrastruktur.
  Backup, Endpoint-Software und Roaming-Profile des Arbeitgebers können darauf zugreifen. „Alles läuft
  lokal" heißt hier nicht „nur du kommst dran".
- Die Installation ist **nicht signiert**. Windows SmartScreen zeigt beim ersten Start eine Warnung; sie
  wird über „Weitere Informationen → Trotzdem ausführen" bestätigt und braucht keine Adminrechte.
- Nutzung auf eigenes Risiko.

## Lizenz

[MIT](LICENSE)
