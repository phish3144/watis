# WatIs?

Ein Desktop-Client für WhatsApp Web mit lokalem Archiv, Volltextsuche und ordentlicher
Desktop-Integration. Für Windows 10/11 und Linux (x64); macOS wird mitgebaut. Und als
**Browser-Erweiterung für Chrome, Edge und Firefox**, für alle, die nichts installieren dürfen oder
nur im Browser arbeiten ([Im Browser](#im-browser-chrome-edge-firefox)).

> **Status: benutzbar, unsigniert.** Die Releases stehen unter
> [Releases](https://github.com/phish3144/watis/releases). Der Installer ist noch nicht signiert –
> was das beim ersten Start bedeutet, steht unter [Installieren](#installieren). Der verbindliche
> Plan steht in [`PLAN.md`](PLAN.md), die getroffenen Entscheidungen in
> [`docs/decisions/`](docs/decisions/).

## Was es macht

- Hostet `web.whatsapp.com` in Electron mit persistenter Session – kein erneutes QR-Scannen nach Updates
- Spiegelt Nachrichten, Chats und Medien in eine lokale SQLite-Datenbank mit Volltextsuche
- Schreibt ab dem Installationstag lückenlos mit und nimmt beim Verknüpfen mit, was WhatsApp Web
  hergibt – das sind rund 90 Tage, mehr gibt der Web-Client nicht her
- Speichert Dateien ohne Dialog in eine feste Ordnerstruktur
- Macht Text in Bildern (OCR) und in PDFs – auch eingescannten – durchsuchbar; in der
  Browser-Erweiterung auf Klick auch Sprachnachrichten
- Tray, Badge, native Benachrichtigungen, Autostart, Shortcuts, Themes, Declutter-Schalter
- Exportiert alles in offene Formate (JSON, HTML, TXT)

Alles läuft lokal. Keine Telemetrie, keine Cloud, keine Accounts, keine laufenden Kosten.

## Was es bewusst nicht macht

- **Kein Protokoll-Client.** Alles läuft über den offiziellen Web-Client.
- **Keine Sende-Automatisierung.** Kein Scheduling, keine Bots, kein Bulk, kein Auto-Reply.
- **Kein Schreiben oder Löschen** über die internen Schnittstellen von WhatsApp Web. Die Bridge ist strikt
  read-only.
- **Nichts, was Adminrechte braucht.** Keine Dienste, keine HKLM-Registry, keine offenen Ports.

## Installieren

### Windows

Windows 10 oder 11, 64 Bit. Keine Adminrechte, kein Node, kein Compiler.

1. [Neuestes Release](https://github.com/phish3144/watis/releases/latest) öffnen und
   **`WatIs-Setup-x64.exe`** herunterladen.
2. Doppelklick. Windows SmartScreen meldet sich, weil der Installer nicht signiert ist:
   **Weitere Informationen → Trotzdem ausführen**. Kein UAC-Dialog, keine Adminrechte – die
   Installation landet unter `%LOCALAPPDATA%\Programs\WatIs\`.
3. Die App startet von selbst und zeigt den QR-Code von WhatsApp Web. Einmal mit dem Telefon
   scannen.

Wer nichts installieren will, nimmt **`WatIs-Portable-x64.exe`** – eine einzelne Datei, die sich beim
Start selbst entpackt. Daten und Sitzung liegen in beiden Fällen an derselben Stelle unter
`%LOCALAPPDATA%\watis\`, ein Wechsel zwischen beiden kostet also kein erneutes Scannen.

Fehlt der Knopf „Trotzdem ausführen", greift eine Richtlinie des Arbeitgebers – dazu
[`docs/managed-deployment.md`](docs/managed-deployment.md).

### Linux (Ubuntu und andere)

64 Bit. Kein `sudo`, kein Paketmanager, keine Systeminstallation.

1. [Neuestes Release](https://github.com/phish3144/watis/releases/latest) öffnen und
   **`WatIs-x86_64.AppImage`** herunterladen — am besten nach `~/Applications/`.
2. Ausführbar machen und starten:

```bash
chmod +x ~/Applications/WatIs-x86_64.AppImage
~/Applications/WatIs-x86_64.AppImage
```

Beim ersten Start trägt sich WatIs? selbst in den Desktop ein: Menüeintrag, Icon, auffindbar über
die Suche. Alles unter `~/.local/share/` — nichts außerhalb deines Benutzerkontos. Verschiebst du
das AppImage später, korrigiert sich der Eintrag beim nächsten Start von selbst.

**Deinstallieren** heißt: das AppImage löschen, dazu
`~/.local/share/applications/watis.desktop`, `~/.local/share/icons/hicolor/512x512/apps/watis.png`
und – falls Autostart aktiviert war – `~/.config/autostart/watis.desktop`. Das Archiv liegt separat
unter `~/.local/share/watis/` und bleibt, bis du es selbst entfernst.

**Zum Tray unter GNOME:** GNOME zeigt seit Version 3.26 keine Tray-Icons mehr. WatIs? erkennt das
und beendet sich dann beim Schließen des Fensters, statt in einen unsichtbaren Tray zu
verschwinden. Wer die AppIndicator-Erweiterung installiert hat und den Tray trotzdem will, startet
mit `WATIS_FORCE_TRAY=1`. Unter KDE, XFCE, MATE und Cinnamon funktioniert der Tray direkt.

Warum AppImage und kein `.deb`: [ADR 0009](docs/decisions/0009-linux-appimage-und-gnome.md).

### Die ersten fünf Minuten

Rechts liegt das eigene Panel: **Archiv und Einstellungen**. Es ist beim ersten Start offen, lässt
sich über die Leiste am rechten Rand, **Strg + ,** oder das Tray-Menü ein- und ausblenden, und merkt
sich den Zustand.

- **Oben steht, ob mitgeschrieben wird.** Solange das Archiv leer ist, sagt das Panel, woran es
  gerade liegt – nicht verknüpft, Bridge nicht aufgelöst, oder schlicht noch keine Nachricht
  eingetroffen.
- **Jetzt übernehmen** holt in einem Zug, was WhatsApp Web bereits im Speicher hat. Danach wächst
  das Archiv von selbst weiter.
- Die Suche greift auf alles zu, was einmal gespiegelt wurde – Text, Dateinamen, erkannten Text aus
  Bildern und PDFs.
- **Hilfe** ist eingebaut: der Reiter **Hilfe** im Panel, ein **?** neben jedem Abschnitt der
  Einstellungen und ein **Mehr dazu** an den Statuszeilen. Sie funktioniert ohne Netz, in der
  Desktop-App wie in der Browser-Erweiterung.

Rückwirkend gibt es wenig zu holen; warum, steht unter [Ehrliche Hinweise](#ehrliche-hinweise).

### Updates

Die App prüft alle sechs Stunden bei GitHub Releases, ob eine neue Version vorliegt, lädt sie im
Hintergrund und meldet sich erst, wenn sie fertig ist: **Jetzt neu starten** oder **Beim nächsten
Beenden** installieren. Abschalten lässt sich das im Panel unter Einstellungen; der Knopf für eine
Prüfung von Hand bleibt dann bestehen.

`session/`, `archive/` und `blobs/` fasst ein Update nicht an – kein erneutes Scannen, kein
verlorenes Archiv. Ein E2E-Test beweist das bei jedem Commit.

SmartScreen meldet sich nur beim ersten Mal: die Updates lädt und startet die App selbst, sie kommen
nicht durch den Browser.

### Im Browser (Chrome, Edge, Firefox)

Dieselbe Bridge, dasselbe Archiv und dieselbe Suche, als Erweiterung direkt in `web.whatsapp.com`.
Keine Installation auf dem Rechner, keine Adminrechte. Eine gehostete Web-Version gibt es nicht und
kann es nicht geben ([ADR 0010](docs/decisions/0010-browser-erweiterung.md)).

Bis die Erweiterung in den Stores steht, wird sie selbst gebaut (`npm ci && npm run build:extension`)
oder als Artefakt `browser-extension` aus einem CI-Lauf genommen:

- **Chrome / Edge:** `chrome://extensions` bzw. `edge://extensions` öffnen, **Entwicklermodus** an,
  **Entpackte Erweiterung laden** und `out/extension/chromium` wählen.
- **Firefox:** `about:debugging#/runtime/this-firefox` öffnen, **Temporäres Add-on laden** und
  `out/extension/firefox/manifest.json` wählen. Temporär heißt: Nach einem Neustart von Firefox ist
  es weg, bis es auf addons.mozilla.org signiert ist.

Dann WhatsApp Web öffnen und anmelden. Das Symbol in der Symbolleiste öffnet das Panel neben
WhatsApp (Seitenleiste); daraus geht es auch als großes Fenster in einem eigenen Tab.

|                                     | Chrome, Edge | Firefox                          |
| ----------------------------------- | ------------ | -------------------------------- |
| Archiv, Suche, Chats, Medien        | ja           | ja                               |
| Texterkennung in Bildern und PDFs   | ja           | ja                               |
| Sprachnachrichten transkribieren    | ja           | ja, WhatsApp-Tab muss offen sein |
| Badge, Benachrichtigungen, Ruhezeit | ja           | ja                               |
| Downloads in Ordner pro Chat        | ja           | nein                             |
| Sicherung in einen gewählten Ordner | ja           | nein, als ZIP                    |

Das Archiv liegt **im Browserprofil**. Abmelden, Cache leeren und Updates überlebt es, das Entfernen
der Erweiterung nicht. Deshalb gibt es unter Einstellungen die **Sicherung**, in einen Ordner
(Chrome, Edge) oder als ZIP. Sie hat dasselbe Format wie die Sicherung der Desktop-App
([ADR 0011](docs/decisions/0011-medien-dauerhaft-sichern.md)).

Transkribieren ist ein Klick auf **Transkribieren** unter der Sprachnachricht; eine, die noch nicht
im Archiv ist, wird dabei geholt. Beim ersten Mal bietet der Knopf das Sprachmodell an, 57 MB
(„Schnell"), und lädt es erst nach einem zweiten Klick, gegen eine hinterlegte Prüfsumme geprüft.
„Genau" (181 MB) lässt sich in den Einstellungen dazuholen. Ist GitHub im Firmennetz gesperrt, nimmt
die Erweiterung dieselbe Datei auch von der Platte
([ADR 0012](docs/decisions/0012-ocr-und-transkription-im-browser.md)).

Im Browser gibt es kein Tray, keinen Autostart, keine Direktantwort, kein Nachladen älterer
Nachrichten und keinen Export als JSON/HTML/TXT. Das bleibt der Desktop-App vorbehalten.

## Aus dem Quelltext bauen

Voraussetzung: Node 22 oder neuer und Git. Sonst nichts — kein Compiler, keine Adminrechte, kein
Python. `better-sqlite3` kommt als vorgebautes Node-API-Binary, es wird nichts nachgebaut.

```bash
git clone https://github.com/phish3144/watis.git
cd watis
npm ci
npm run dev
```

### Nützliche Kommandos

|                           |                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`             | Entwicklungsmodus mit Hot Reload                                                                                          |
| `npm run verify`          | Format, Lint, Typen, Unit- und Integrationstests — Sekunden                                                               |
| `npm run test:e2e`        | Playwright gegen die echte Electron-App                                                                                   |
| `npm run gate:release`    | Alles davon plus Lasttest ([`docs/lasttest.md`](docs/lasttest.md))                                                        |
| `npm run dist:win`        | Per-User-Installer, ohne Adminrechte ([`docs/managed-deployment.md`](docs/managed-deployment.md))                         |
| `npm run build:extension` | Browser-Erweiterung nach `out/extension/chromium` und `out/extension/firefox`; `pack:extension` zippt sie für die Stores  |
| `npm run test:extension`  | Erweiterung in Chromium gegen eine nachgebaute WhatsApp-Seite; `test:extension:firefox` dasselbe in Firefox (`FIREFOX=…`) |
| `npm run models:fetch`    | Sprachmodelle holen und prüfen (`base` reicht für die Tests); gibt die Befehle fürs Modell-Release aus                    |

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
- Das Archiv enthält Nachrichten anderer Leute, **auch gelöschte** – auch solche, die der Absender
  für alle gelöscht hat – und **auch verschwindende**, sobald sie einmal gespiegelt wurden. Bei einer
  verschwindenden Nachricht war die Befristung von Anfang an die Bedingung, unter der sie geschickt
  wurde, und beim Löschen für alle wollte der Absender sie zurückhaben – dieses Archiv hält beide
  trotzdem, mit Text und Anhang, als gelöscht markiert
  ([ADR 0013](docs/decisions/0013-geloeschte-nachrichten-bleiben.md)). Das ist eine bewusste
  Entscheidung und je nach Umfeld und Rechtslage eine, die man treffen muss, nicht eine, die einem
  passiert.
- Läuft die App auf einem **verwalteten Firmengerät**, liegt das Archiv auf fremder Infrastruktur.
  Backup, Endpoint-Software und Roaming-Profile des Arbeitgebers können darauf zugreifen. „Alles läuft
  lokal" heißt hier nicht „nur du kommst dran".
- Die Installation ist **nicht signiert**. Windows SmartScreen zeigt beim ersten Start eine Warnung; sie
  wird über „Weitere Informationen → Trotzdem ausführen" bestätigt und braucht keine Adminrechte. Ein
  Antrag bei SignPath Foundation läuft; sobald er durch ist, sind die Releases signiert und die
  Warnung verschwindet ([`docs/code-signing-policy.md`](docs/code-signing-policy.md)).
- **Im Browser** gehört das Archiv zum Browserprofil. Wird die Erweiterung entfernt oder das Profil
  zurückgesetzt, ist es weg. Eine Sicherung außerhalb des Browsers ist dort keine Kür. Auf
  verwalteten Rechnern kann die IT Erweiterungen sperren oder nur freigegebene zulassen.
- Nutzung auf eigenes Risiko.

## Lizenz

[MIT](LICENSE)
