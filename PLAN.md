# WhatsApp Desktop Wrapper – Entwicklungsplan

> Arbeitstitel: **wawrap** (frei änderbar). Dieses Dokument ist die Arbeitsgrundlage für Claude Code.
> Als `PLAN.md` ins Repo legen und aus `CLAUDE.md` referenzieren. Phasen werden der Reihe nach
> abgearbeitet, Checkboxen im Dokument gepflegt. Sprache im Code: Englisch. UI-Sprache: Deutsch (i18n-fähig).

---

## 0. Kurzfassung

Ein eigener Desktop-Client, der `web.whatsapp.com` in Electron hostet und drumherum das baut, was die
offizielle App (seit Dezember 2025 selbst nur ein WebView2-Wrapper um WhatsApp Web) nicht kann:

- saubere Desktop-Integration (Tray, Badge, Notifications mit Direktantwort, Shortcuts, Autostart)
- vernünftige Dateibehandlung (kein Dialog, feste Ordnerstruktur, Öffnen/Drag-out, Auto-Archiv)
- ein lokales, durchsuchbares Archiv aller Nachrichten und Medien (SQLite + FTS5)
- Backfill der History vom Handy, damit „weit zurück" endlich geht
- Export/Backup in offene Formate
- Entrümpelung (Channels, Status/Werbung, Meta AI ausblendbar) und Anpassbarkeit (Dichte, Schrift, Theme)
- ein Inhaltsindex: OCR auf Bildern, Textextraktion aus PDF/DOCX, Transkription von Sprachnachrichten –
  alles durchsuchbar wie eine normale Nachricht

Ausgelegt auf hohes Aufkommen: viele Gruppen, Millionen Nachrichten, hunderttausende Dateien (Vorgaben in §3.1).

Plattform: Windows 10/11 zuerst (Release), macOS wird von Anfang an mitgebaut und darf durch keine
Entscheidung ausgeschlossen werden. Installation und Updates laufen ohne Administratorrechte.

**Bewusst nicht:** kein Protokoll-Client (kein whatsmeow/Baileys), keine Sende-Automatisierung.

---

## 1. Ziele (messbar)

| Ziel                   | Kriterium                                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stabil als Tagesclient | Läuft 7 Tage ohne Neustart, Session bleibt erhalten, kein erneutes QR-Scannen                                                                                                                                                |
| Dateien ohne Reibung   | Download landet ohne Dialog im richtigen Ordner; Doppelklick öffnet; Drag-out funktioniert                                                                                                                                   |
| Suche                  | Volltext über alle Chats < 200 ms bei 5 Mio. Nachrichten (typische Anfrage); Filter Absender/Chat/Datum/Medientyp/Quelle                                                                                                     |
| Inhaltsindex           | Text in Bildern (OCR), PDF/DOCX und Sprachnachrichten ist durchsuchbar; Treffer zeigen Quelle und Vorschau                                                                                                                   |
| Skalierung             | Mengengerüst aus §3.1 ohne spürbare Verzögerung; Main-Prozess blockiert nie länger als 16 ms; Index läuft nur im Leerlauf                                                                                                    |
| Plattform              | Läuft auf Windows 10/11 (x64); macOS-Build (arm64 + x64) ist in CI ab Phase 0 grün, auch wenn er erst später veröffentlicht wird                                                                                             |
| Installation           | Installer und Auto-Update laufen auf einem Standardbenutzer-Konto ohne UAC-Abfrage durch; kein Systemdienst, kein HKLM, kein offener Port                                                                                    |
| History                | Ab Installation lückenlos vorwärts; beim Verknüpfen zusätzlich so viel, wie WhatsApp Web liefert (**gemessen: 90 Tage Decke**, [ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) A); fortsetzbar nach Abbruch |
| Backup                 | Vollständiger Export (JSON + Medien) reproduzierbar; inkrementell; per restic/rsync sicherbar                                                                                                                                |
| Robustheit             | Fällt die Internals-Bridge aus, bleibt alles andere nutzbar (Degradation statt Bruch)                                                                                                                                        |
| Ressourcen             | Ein Chromium-Renderer für WA Web, kein zweiter für Tray/Menüs; RAM im Bereich eines Chrome-Tabs                                                                                                                              |

---

## 2. Nicht-Ziele

- **Kein eigener Protokoll-Client.** Alles läuft über den offiziellen Web-Client.
- **Keine Sende-Automatisierung.** Kein Scheduling, keine Bots, kein Bulk, kein Auto-Reply. Auch nicht „optional".
- **Kein Schreiben/Löschen über Internals.** Die Bridge ist strikt read-only (lesen, beobachten, Medien laden).
  Einzige Ausnahme vom Sendeverbot ist die Direktantwort aus der Benachrichtigung – sie läuft über die
  sichtbare Eingabezeile der Oberfläche, nicht über Internals, und ist in
  [ADR 0004](docs/decisions/0004-bridge-roaming-direktantwort.md) Abschnitt C eng umrissen.
- **Kein Multi-Window derselben Session.** WhatsApp Web erlaubt nur eine aktive Instanz pro Session
  („WhatsApp ist in einem anderen Fenster geöffnet"). Pop-out-Chats sind damit nicht machbar.
- **Keine serverseitigen Limits umgehen** (Edit-Zeitfenster, Dateigrößen, Status posten etc.).
- **Keine Telemetrie, keine Cloud, keine externen Dienste.** Auch Transkription läuft lokal.
- **Nichts, was Adminrechte braucht.** Keine Dienste, Treiber, HKLM-Einträge, offenen Ports oder
  systemweiten Installationen – auch nicht für Updates oder Sidecars (whisper.cpp, OCR-Modelle).

---

## 3. Leitprinzipien

1. **Read-only gegenüber WA-Web-Internals.** UI-Aktionen nur dort, wo sie exakt dem entsprechen, was
   ein Nutzer per Hand klickt (z. B. „ältere Nachrichten laden"), und in menschlichem Tempo.
2. **Degradation statt Bruch.** Jede Funktion, die von Internals abhängt, hat ein Feature-Flag und
   einen Healthcheck. Schlägt der fehl: Funktion aus, Banner, Rest läuft.
3. **Session ist heilig.** Persistente Partition, nie Storage löschen, Cache-Bereinigung nur selektiv.
4. **Archiv außerhalb des Webview-Storage.** Ein Re-Link oder Cache-Clear darf das Archiv nicht anfassen.
5. **Lokal und kostenlos.** Keine laufenden Kosten, keine Accounts, keine Server.
6. **Datenschutz ist Nutzerentscheidung.** Klartext-Archiv ist Default, Verschlüsselung ist Option (siehe §10).
7. **Kleine Schritte.** Jede Phase liefert etwas Nutzbares. Erst Hülle, dann Dateien, dann erst Internals.
8. **Für Masse gebaut.** Die Vorgaben in §3.1 gelten ab Phase 0, nicht erst, wenn es zwickt.
9. **Standardbenutzer ist der Normalfall.** Alles läuft aus `%LOCALAPPDATA%`; jede Funktion, die auf einem
   Konto ohne Adminrechte nicht geht, ist falsch gebaut. Große Daten nie ins Roaming-Profil (`%APPDATA%`).
10. **Plattformabstraktion statt Windows-Sonderwege.** OS-spezifische Aufrufe (Notifications, Autostart,
    Badge, Protokoll-Handler, Dateimanager, Sidecar-Binaries) laufen über ein `platform/`-Interface mit
    Windows-Implementierung und macOS-Implementierung oder -Stub. `CommandOrControl` statt `Ctrl`.

### 3.1 Skalierungsvorgaben (verbindlich)

Mengengerüst, gegen das entworfen und getestet wird: ≥ 500 Chats (davon ≥ 200 Gruppen),
≥ 5 Mio. Nachrichten im Archiv, ≥ 100.000 Mediendateien / ≥ 200 GB, Spitzen von ≥ 5.000 neuen
Nachrichten pro Stunde, ≥ 20.000 offene Index-Jobs nach dem Erstimport.

- **Kein Rechnen im Main-Prozess.** Archiv (SQLite) und Inhaltsindex (OCR/PDF/Whisper) laufen als
  eigene `utilityProcess`-Instanzen; Main koordiniert nur. Synchrone Platten- oder DB-Zugriffe im Main sind ein Bug.
- **Batches statt Einzelschreibvorgänge.** Flush alle ~250 ms oder ab 500 Datensätzen, eine Transaktion
  pro Batch; WAL-Modus, `synchronous=NORMAL`.
- **Bridge → Main über Ringpuffer** mit Batch-IPC, nie ein IPC-Call pro Nachricht. Kommt das Archiv
  nicht hinterher, wächst der Puffer (Backpressure-Zähler sichtbar in der UI); WA Web wartet nie.
- **Import und Backfill gestückelt:** Chat für Chat, Batches ≤ 500 Nachrichten, Yield zwischen Batches,
  damit WA Web bedienbar bleibt; Fortschritt persistent, jederzeit fortsetzbar.
- **Medien content-addressed:** Blob-Store `blobs/<aa>/<bb>/<sha256>.<ext>` (2-stufiges Sharding),
  Dedupe automatisch, mehrere Nachrichten referenzieren denselben Blob. Videos nur manuell, Quota mit
  Warnung, Speicherort frei wählbar (anderes Laufwerk/NAS) und verschiebbar.
- **Alles paginiert und virtualisiert.** Chatliste, Nachrichtenliste, Trefferliste, Galerie laden
  seitenweise aus SQLite (Keyset-Pagination über `ts, id`); „alles laden" gibt es nicht.
- **Indizes:** `messages(chat_id, ts)`, `messages(sender_jid, ts)`, `media(sha256)`,
  `media(chat_id, mime)`, `index_jobs(status, priority)`; FTS als external-content, kein doppelter Text.
- **Notifications bündeln:** pro Chat und 3-s-Fenster ein Toast; stummgeschaltete Chats bleiben stumm,
  landen aber im Archiv.
- **Backfill priorisiert:** Direktchats und markierte Gruppen zuerst; Tiefe pro Chat konfigurierbar
  (z. B. laute Gruppen nur 12 Monate).
- **Index nur im Leerlauf:** Nutzer inaktiv, Netzstrom (Laptop), Parallelität 1–2, Pause im Tray.
- **Lasttest ist Release-Gate** (§8) und Teil der Definition of Done der Phasen 3, 4 und 7.

---

## 4. Kritikpunkte an der offiziellen App → Maßnahmen

Gesammelt aus Reviews, Foren und Issue-Trackern zur WebView2-Version und zu WhatsApp Web allgemein.

| #   | Kritikpunkt                                                                                 | Maßnahme                                                                                                                                                                                                                                                                                          | Phase |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 1   | RAM 2–3 GB, viele Hintergrundprozesse                                                       | Ein Renderer, eigene UI ohne zweites Chromium, Cache-Limits, Hintergrund-Throttling aus (sonst Notifications-Verzögerung)                                                                                                                                                                         | 0–1   |
| 2   | Nach Updates erneut QR scannen, Session weg                                                 | Persistente Partition, Storage nie löschen, Session-Verzeichnis vom Updater ausnehmen                                                                                                                                                                                                             | 0     |
| 3   | Notifications unzuverlässig, keine Direktantwort, Ping trotz offenem Fenster                | Native Notifications, Fokus-Logik (kein Ping für sichtbaren Chat), Direktantwort als eng begrenzte Ausnahme nach [ADR 0004](docs/decisions/0004-bridge-roaming-direktantwort.md) C (Electron 44 kann Inline-Reply auf beiden OS), DND-Zeitplan                                                    | 1     |
| 4   | Kein Close-to-Tray, kein minimierter Autostart, Fensterposition vergessen                   | Tray mit Badge, Autostart minimiert, Fenster-Bounds merken, globaler Show/Hide-Shortcut                                                                                                                                                                                                           | 1     |
| 5   | Kein Zoom in Fotos, browserartiges Kontextmenü, Audio-Glitches bei Sprachnachrichten        | Eigener Medien-Viewer (Zoom/Pan/Tastatur), natives Kontextmenü (Copy/Save/Spellcheck), Audio-Ausgabegerät wählbar                                                                                                                                                                                 | 1     |
| 6   | Kein Multi-Account                                                                          | Tabs mit getrennten Sessions (`persist:acct-<n>`)                                                                                                                                                                                                                                                 | 8     |
| 7   | Kein Backup/Export am Desktop                                                               | Archiv + Export (JSON/HTML/TXT), inkrementell                                                                                                                                                                                                                                                     | 3, 6  |
| 8   | Suche nur über lokal vorhandene, junge History; „Nutze dein Telefon für ältere Nachrichten" | Eigenes Archiv ab Installationstag + FTS-Suche + Archivansicht mit Endlos-Scroll und Datumssprung. Das 90-Tage-Fenster von WA Web entfällt für alles, was seit der Installation lief; rückwirkend lässt es sich nicht öffnen ([ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) A) | 3–5   |
| 9   | Download-Dialog bei jeder Datei, kein Zielordner, kein Drag-out, Öffnen umständlich         | Download-Hook, Ordnerschema, Öffnen mit System-App, Drag-out, Auto-Archiv-Regeln                                                                                                                                                                                                                  | 2     |
| 10  | Kaum Anpassung (Theme, Schrift, Dichte)                                                     | CSS-Layer: Kompaktmodus, Schriftgröße, Themes, eigene CSS-Datei des Nutzers                                                                                                                                                                                                                       | 1     |
| 11  | Channels, Status/„Aktuelles" (inkl. Werbung), Meta AI nicht ausblendbar                     | Declutter-Schalter pro Element                                                                                                                                                                                                                                                                    | 1     |
| 12  | Lange Sprachnachrichten, keine Transkription am Desktop                                     | Lokale Transkription mit whisper.cpp, Ergebnis ins Archiv (durchsuchbar)                                                                                                                                                                                                                          | 7     |
| 13  | Chat mit nicht gespeicherter Nummer umständlich                                             | „Chat mit Nummer"-Dialog, `whatsapp://`- und `wa.me`-Links werden von der App übernommen                                                                                                                                                                                                          | 8     |
| 14  | Links öffnen im falschen Kontext / neues Fenster                                            | Externe Links immer im Standardbrowser                                                                                                                                                                                                                                                            | 0     |
| 15  | Enter vs. Shift+Enter nicht konfigurierbar                                                  | Umschaltbar (Enter = Zeilenumbruch)                                                                                                                                                                                                                                                               | 1     |
| 16  | Bildschirmfreigabe/Anrufe ruckelig, Quellenwahl fehlt                                       | Permission-Handler für Mic/Cam, eigener Display-Media-Picker (Fenster/Screen)                                                                                                                                                                                                                     | 1     |
| 17  | Rechtschreibprüfung nur eine Sprache                                                        | Mehrere Wörterbücher (DE + EN)                                                                                                                                                                                                                                                                    | 1     |
| 18  | Kein Überblick über Speicherverbrauch, keine Bereinigung                                    | Storage-Übersicht (Session-Cache, Archiv, Blob-Store, Index-Queue) + selektive Bereinigung                                                                                                                                                                                                        | 9     |
| 19  | Mobil-exklusive Funktionen fehlen am Desktop                                                | Nicht lösbar (serverseitig). Wird ehrlich als bekannt dokumentiert, nicht nachgebaut                                                                                                                                                                                                              | –     |
| 20  | Suche findet nichts in Bildern, PDFs oder Sprachnachrichten                                 | Inhaltsindex: OCR (PP-OCRv5), PDF/DOCX-Textextraktion, Whisper-Transkription – alles im Suchindex mit Quellenanzeige                                                                                                                                                                              | 7     |
| 21  | Bei vielen Gruppen und Dateien wird alles zäh, Speicher läuft voll                          | Skalierungsvorgaben §3.1: eigene Prozesse, Batches, Sharding, Dedupe, Quota, Pagination                                                                                                                                                                                                           | 0, 3  |

---

## 5. Architektur

### 5.1 Übersicht

```
┌──────────────────────────────────────────────────────────────────────┐
│ Electron Main Process (koordiniert nur, rechnet nicht)               │
│  window/   tray/   notifications/   downloads/   shortcuts/  updater/│
│  backfill/ (Scheduler für „ältere Nachrichten laden")                 │
│  ipc/      (typisierte Kanäle, zod-Schemas, Batch-Nachrichten)        │
│    ├─ utilityProcess „archive": SQLite (WAL), FTS, Blob-Store, Export │
│    └─ utilityProcess „index":   Job-Queue, OCR, PDF/DOCX-Text, Whisper│
└───────────────┬──────────────────────────────────┬───────────────────┘
                │ IPC                              │ IPC
┌───────────────▼───────────────┐   ┌──────────────▼───────────────────┐
│ WebContentsView „wa"           │   │ WebContentsView „app" (React)     │
│ lädt web.whatsapp.com          │   │ Archiv, Suche, Einstellungen,     │
│ partition: persist:wa          │   │ Medien-Viewer, Storage, Backfill  │
│ preload (isolated world):      │   │ UI                                │
│   ui-layer (CSS/JS-Injection)  │   └──────────────────────────────────┘
│   bridge-host (Nachrichten-    │
│   kanal zur Page-World)        │
│ page world:                    │
│   bridge (read-only Zugriff    │
│   auf interne Stores)          │
└────────────────────────────────┘
```

Beide Views liegen in einem `BaseWindow` nebeneinander (WA links, eigene UI als ein-/ausklappbares
Seitenpanel rechts). Kein `<webview>`-Tag, kein deprecated `BrowserView`.
Archiv und Inhaltsindex laufen als `utilityProcess` (eigene Node-Prozesse, Anbindung über MessagePorts mit
zod-Schemas), damit weder WA Web noch die eigene UI je auf Datenbank- oder Rechenarbeit warten.

### 5.2 Datenfluss

- **Live-Spiegelung:** Bridge hört auf Ereignisse der internen Message-/Chat-Collections → normalisiert
  Datensätze → Ringpuffer → alle ~250 ms ein Batch per `postMessage` an Preload → IPC an Main →
  `archive`-Prozess schreibt den Batch in einer Transaktion. Kommt das Archiv nicht hinterher, wächst
  der Puffer; WA Web wartet nie.
- **Initialer Import:** Beim ersten Start mit funktionierender Bridge werden alle lokal vorhandenen
  Nachrichten chatweise durchgelesen und gespiegelt.
- **Backfill:** `backfill`-Scheduler öffnet Chat, löst „ältere Nachrichten laden" aus, wartet auf neue
  Datensätze (kommen über die Live-Spiegelung rein), wiederholt gedrosselt.
- **Medien:** Für Nachrichten mit Medien fordert die Bridge den Download über die interne
  Download-Funktion an (das ist derselbe Weg, den ein Klick auslöst), Bytes gehen an Main → Media-Store.
- **Downloads (Dokumente per Klick):** `session.on('will-download')` → Pfadschema → speichern → optional
  ins Archiv verlinken.
- **Inhaltsindex:** Nach jedem abgeschlossenen Medien-Download legt `archive` einen Job in `index_jobs`
  an (Bild → OCR, PDF/DOCX → Textextraktion, Sprachnachricht → Transkription). Der `index`-Prozess
  arbeitet die Queue im Leerlauf nach Priorität ab, schreibt nach `content_text`; Trigger pflegen den
  gemeinsamen Suchindex. Jeder Datensatz trägt Engine und Version, damit später neu indiziert werden kann.

### 5.3 Speicherorte

Electron legt `userData` unter Windows standardmäßig ins Roaming-Profil (`%APPDATA%`). Das ist bei
Domänen-Konten mit Roaming-Profilen fatal (Gigabytes würden synchronisiert). Deshalb werden `userData`
und `sessionData` beim Start explizit nach `%LOCALAPPDATA%\wawrap\` gesetzt; nur `config.json` darf
klein bleiben. Unter macOS entspricht das `~/Library/Application Support/wawrap/`.

```
wawrap/                    # Windows: %LOCALAPPDATA%\wawrap\ – macOS: ~/Library/Application Support/wawrap/
  session/                 # Chromium-Partition persist:wa – niemals anfassen
  archive/archive.sqlite   # Nachrichten, Chats, Kontakte, FTS
  blobs/<aa>/<bb>/<sha256>.<ext>   # Medien content-addressed: Dedupe automatisch, 2-stufiges Sharding;
                                   # Ordner frei wählbar (anderes Laufwerk/NAS) und verschiebbar
  models/                  # OCR- und Whisper-Modelle, einmaliger Download beim ersten Start
  downloads-default -> ~/WhatsApp/<Chatname>/   (konfigurierbar)
  config.json
  logs/
  bridge/last-known-good.json   # Modul-Map + WA-Web-Version, für die die Bridge zuletzt lief
```

### 5.4 Datenmodell (SQLite)

```sql
chats(id TEXT PK, jid TEXT, name TEXT, kind TEXT /*dm|group|broadcast|channel*/,
      last_msg_ts INTEGER, is_archived INTEGER, raw_json TEXT);
contacts(jid TEXT PK, name TEXT, pushname TEXT, phone TEXT);
messages(id TEXT PK, chat_id TEXT, sender_jid TEXT, ts INTEGER, kind TEXT,
         body TEXT, quoted_id TEXT, media_id TEXT, edited INTEGER, revoked INTEGER,
         from_me INTEGER, raw_json TEXT);
media(id TEXT PK, msg_id TEXT, chat_id TEXT, mime TEXT, size INTEGER, sha256 TEXT,
      filename TEXT, status TEXT /*pending|done|failed|skipped*/);
      -- Pfad wird aus sha256 abgeleitet (Blob-Store), nicht gespeichert
sync_state(chat_id TEXT PK, oldest_ts INTEGER, newest_ts INTEGER,
           backfill_done INTEGER, depth_limit_ts INTEGER, priority INTEGER,
           last_error TEXT, updated_ts INTEGER);
content_text(id INTEGER PK, msg_id TEXT, media_id TEXT,
             source TEXT /*ocr|pdf|docx|text|transcript*/, text TEXT, detail_json TEXT /*Boxen, Seiten, Zeitmarken*/,
             engine TEXT, engine_version TEXT, lang TEXT, confidence REAL, created_ts INTEGER);
index_jobs(id INTEGER PK, media_id TEXT, kind TEXT /*ocr|pdf|docx|text|transcript*/, priority INTEGER,
           attempts INTEGER, status TEXT /*queued|running|done|failed|skipped*/,
           last_error TEXT, updated_ts INTEGER);
search_docs(rowid INTEGER PK, msg_id TEXT, chat_id TEXT, ts INTEGER,
            source TEXT /*body|filename|ocr|pdf|docx|text|transcript*/, text TEXT);
search_fts USING fts5(text, source UNINDEXED, chat_id UNINDEXED,
                      content='search_docs', content_rowid='rowid',
                      tokenize='unicode61 remove_diacritics 2');
-- Trigger: messages.body, media.filename und content_text.text → search_docs → search_fts
-- optional zusätzlich trigram-FTS für Substring-Suche
-- Indizes: messages(chat_id, ts), messages(sender_jid, ts), media(sha256), media(chat_id, mime),
--          index_jobs(status, priority), search_docs(msg_id), content_text(media_id, source)
```

- `raw_json` bewahrt das Original, damit Schema-Änderungen später nachziehbar sind.
- Message-IDs von WA sind Strings; nie umformen.
- Ein Suchindex für alles: `search_docs` ist die einzige Quelle für `search_fts`; `source` erlaubt
  Filter und Trefferanzeige („gefunden im Bild / in PDF-Seite 3 / bei 1:24 in der Sprachnachricht").
- Kein Text wird doppelt gehalten (external-content-FTS); `detail_json` liefert die Vorschau-Position.
- `search_docs.text` enthält die **normalisierte** Form, nicht das Original: `ß→ss` und jedes Token mit
  Umlaut zusätzlich in Digraph-Schreibweise (`ae/oe/ue`). Ohne das findet „Muenchen" das Wort „München"
  nicht und umgekehrt – gemessen, siehe [ADR 0002](docs/decisions/0002-deutsche-suchnormalisierung.md).
  Die Anfrage wird symmetrisch normalisiert. Original bleibt in `messages.body` / `content_text.text`.
- Neu-Indizierung pro `source` und Engine-Version, ohne andere Quellen anzufassen.

### 5.5 Bridge-Design (der fragile Teil)

- Läuft in der **Page-World** (per `executeJavaScript`), weil interne Module nur dort erreichbar sind.
  Preload bleibt isoliert und ist reiner Nachrichtenkanal (`contextBridge`).
- **Modulauflösung:** Referenz ist whatsapp-web.js (`src/util/Injected/`) – nur als Lesevorlage für
  das Finden der internen Stores, **nicht als Dependency** (bringt Puppeteer mit). Eigene, schlanke
  Implementierung; jede aufgelöste Abhängigkeit wird in `docs/bridge-map.md` mit der WA-Web-Version
  dokumentiert, gegen die sie verifiziert wurde.
- **Erlaubte Operationen:** Chats/Kontakte lesen, Nachrichten lesen und beobachten, Medien laden,
  aktuellen Chat ermitteln, Chat öffnen und zu einer Nachricht scrollen. Sonst nichts.
- **Healthcheck beim Start:** löst alle benötigten Module auf, prüft Signaturen (Feldnamen, Typen),
  meldet Status an Main. Fehlt etwas → betroffene Features aus, Banner in der App-UI, Log.
- **Version-Fingerprint:** WA-Web-Version wird geloggt; bei unbekannter Version läuft der Healthcheck
  strenger (jede Funktion einzeln), Ergebnis wird als last-known-good gespeichert.

### 5.6 Trade-offs (bewusst getroffen)

| Entscheidung                                                                | Warum                                                                                                                                          | Preis                                                                                                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Electron statt Tauri                                                        | Page-Internals, Download-Hooks, DevTools-Protokoll und einheitliches Chromium auf allen OS; unter Linux ist WebKitGTK für WA Web problematisch | Größeres Bundle; RAM-Vorteil gegenüber Store-App ohnehin gering, weil WA Web selbst der Brocken ist                           |
| Eigenes Archiv statt Zugriff auf IndexedDB-Dateien                          | IndexedDB ist inzwischen at rest verschlüsselt (Schlüsselableitung braucht ein Server-Salt)                                                    | Bridge-Abhängigkeit                                                                                                           |
| better-sqlite3 (synchron)                                                   | Einfach, schnell, FTS5 + Trigram dabei; seit v13 N-API mit Prebuilds im Tarball – kein `electron-rebuild` (ADR 0003)                           | Synchron und ohne Progress-Callback: lange Abfragen blockieren den Prozess, der die DB geöffnet hat – deshalb **nie** im Main |
| React für eigene UI                                                         | Vorhandene Next.js-Erfahrung, schnelle Iteration                                                                                               | Zweiter Renderer-Prozess (klein)                                                                                              |
| Read-only-Bridge                                                            | Ban-Risiko minimal halten                                                                                                                      | Keine Komfortfunktionen, die senden                                                                                           |
| Archiv/Index als `utilityProcess` statt im Main                             | Main darf nie blockieren; better-sqlite3 ist synchron; OCR/Whisper rechnen minutenlang                                                         | IPC-Overhead, zwei zusätzliche Node-Prozesse                                                                                  |
| Content-addressed Blob-Store statt Chat-Ordner                              | Dedupe bei vielen Dateien, Sharding, frei verschiebbar                                                                                         | Nicht menschenlesbar – Export (Phase 6) materialisiert Chat-Ordner                                                            |
| PP-OCRv5 über ONNX Runtime statt Tesseract                                  | Deutlich genauer auf Fotos, Screenshots, Belegen; CPU reicht                                                                                   | Community-Ports, Wartung prüfen; Modelle nachladen; Engine hinter Interface kapseln                                           |
| Ein gemeinsamer Suchindex statt einer FTS pro Quelle                        | Eine Anfrage, ein Ranking, Filter per `source`                                                                                                 | Trigger-Logik etwas komplexer                                                                                                 |
| Electron bringt eigenes Chromium mit (kein WebView2-Runtime nötig)          | Keine Abhängigkeit von einer systemweiten Runtime, die ohne Adminrechte fehlen oder veraltet sein könnte                                       | ~100 MB mehr Installationsgröße                                                                                               |
| Per-User-Installer (NSIS, `%LOCALAPPDATA%\Programs`) statt Per-Machine/MSIX | Installation und Auto-Update ohne UAC; Protokoll-Handler und Autostart per HKCU                                                                | Nur für den installierenden Benutzer; unsigniert zeigt SmartScreen eine Warnung                                               |

---

## 6. Tech-Stack

- **Electron 44.0.0** (`WebContentsView`/`BaseWindow`; Chromium 152, Node 24.18.1), **TypeScript 6 strict**
  – exakte Versionen und Begründungen in [ADR 0003](docs/decisions/0003-werkzeugkette-und-versionen.md)
- **electron-vite** (Main/Preload/Renderer-Builds), **React** + Tailwind für die eigene UI
- **better-sqlite3 13** (SQLite 3.53, FTS5 + Trigram, N-API-Prebuilds), Migrations als nummerierte SQL-Dateien
- **utilityProcess** (Electron) für Archiv- und Index-Prozess; Anbindung über MessagePorts, Schemas per zod
- **onnxruntime-node** + PP-OCRv5-Modelle über **ppu-paddle-ocr** oder **paddleocr.js** (Wahl in §10);
  Engine hinter eigenem Interface, **tesseract.js** als Fallback
- **pdfjs-dist** (PDF-Text, Seiten-Rendering für Scan-OCR), **mammoth** (DOCX)
- **whisper.cpp** als Sidecar-Binary (Phase 7), Modell `small` oder `base` für Deutsch; Windows-Build ohne
  Abhängigkeiten, macOS-Build mit Metal
- **zod** für IPC-Schemas (jeder Kanal hat Request/Response-Schema, ungültige Nachrichten werden verworfen)
- **electron-context-menu**, **electron-log**, **electron-store** (Config)
- **electron-builder** + **electron-updater** (GitHub Releases). Windows: NSIS **per-user**
  (`perMachine: false`, Ziel `%LOCALAPPDATA%\Programs\wawrap`, keine UAC-Abfrage), zusätzlich ein
  Portable-Build (einzelne EXE, keine Installation). macOS: dmg + zip, arm64 und x64; Signierung und
  Notarisierung erst zum Mac-Release. Linux nicht geplant, aber nichts baut es aus.
- Sidecars (whisper.cpp, OCR-Modelle) liegen im Installationsordner bzw. in `models/` – nie in Systempfaden
- Tests: **vitest** (Unit/Integration), **Playwright** für Electron-E2E, ESLint + Prettier
- CI: GitHub Actions – Lint, Tests, Build-Matrix **win (Release) + mac (build-only, muss grün sein)**,
  Release-Workflow bei Tag; Installer-Test auf einem Windows-Runner mit Standardbenutzer-Konto

---

## 7. Phasen

Aufwand: S = Stunden, M = 1–2 Tage, L = 3–5 Tage. Reihenfolge ist verbindlich; Phase 8 ist frei wählbar.

### Phase 0 – Bootstrap (S)

Ziel: Fenster, das WA Web lädt, mit persistenter Session und sauberer Basis.

- [x] Repo-Setup: electron-vite, TS strict, ESLint/Prettier, vitest, Playwright-Grundgerüst, CI
- [x] `BaseWindow` + `WebContentsView` „wa" mit `partition: 'persist:wa'`
- [x] User-Agent auf reguläres Chrome setzen (Electron-Token entfernen), Chrome-Version passend zur gebündelten Chromium-Version
      – auf `Chrome/152.0.0.0` reduziert, OS-Token bleibt ehrlich; per E2E geprüft
- [x] `setWindowOpenHandler`: alle externen Links → `shell.openExternal`, nie neue Fenster
- [x] `setPermissionRequestHandler` **und** `setPermissionCheckHandler`: Notifications, Mic, Cam, Clipboard
      erlauben; alles andere ablehnen. Beide sind nötig – WhatsApp fragt den Check-Handler synchron ab und
      verhält sich still falsch, wenn er fehlt
- [x] Hintergrund-Throttling für „wa" aus (`backgroundThrottling: false`)
- [x] Single-Instance-Lock (zweiter Start fokussiert das Fenster)
- [x] Prozessgerüst: `utilityProcess` „archive" und „index" starten, Health-Ping, sauberes Beenden,
      Neustart bei Absturz mit exponentiellem Backoff; typisierte MessagePort-Kanäle mit zod
- [x] Event-Loop-Lag-Watchdog im Main (Warnung im Log ab 16 ms), damit Blockaden früh auffallen
- [x] Pfade: `userData`/`sessionData` beim Start nach `%LOCALAPPDATA%\watis\` setzen (macOS: Application Support);
      nichts Großes im Roaming-Profil. Eine Startzusicherung bricht hart ab, wenn die Umleitung nicht
      gegriffen hat – sonst schreibt die Session still weiter ins alte Verzeichnis
- [x] `platform/`-Interface mit Windows-Implementierung und macOS-Implementierung (Notifications, Autostart,
      Badge, Protokoll-Handler, „Im Ordner zeigen", Sidecar-Pfade). Zwei dokumentierte macOS-Stubs:
      Autostart und Protokoll-Handler brauchen Signierung + Notarisierung
- [x] `app.setAppUserModelId` + Startmenü-Verknüpfung durch den Installer (Voraussetzung für Windows-Toasts);
      ein Unit-Test hält `appId` und `productName` mit der Installer-Konfiguration in Deckung
- [~] Installer: NSIS per-user, Portable-Build, Auto-Update-Grundgerüst **fertig konfiguriert**
  (`oneClick:true` + `perMachine:false` + `packElevateHelper:false`; `npm run verify:no-elevate` ist
  Release-Gate). **Offen: der Test auf dem verwalteten Zielrechner** – Installation, Start, Update,
  Deinstallation ohne UAC, und ob AppLocker/SRP die Ausführung aus `%LOCALAPPDATA%\Programs\WatIs`
  zulässt. Das kann nur auf dem echten Gerät laufen
- [x] Keine lokalen Ports/Listener im gesamten Projekt (vermeidet Firewall-Prompts, die Adminrechte bräuchten)
- [x] CI: Lint/Typecheck/Unit + E2E auf Linux und Windows; Windows-Build als Release-Artefakt,
      macOS-Build unsigniert als Pflicht-Check; Smoke-Test, dass better-sqlite3 ohne Rebuild lädt
- [x] Fenster-Bounds/Maximiert-Zustand speichern und wiederherstellen (mit Prüfung, dass das Fenster nach
      einem Monitorwechsel nicht außerhalb des sichtbaren Bereichs öffnet)
- [x] Logging (electron-log) mit Rotation, Crash-Reporter nur lokal

**DoD:** QR scannen, Chat schreiben, App schließen und neu starten → eingeloggt ohne QR. Externe Links im Browser.
Installer läuft auf einem Standardbenutzer-Konto ohne UAC durch; macOS-Build in CI grün.

### Phase 1 – Hülle & Desktop-Integration (M)

Ziel: Der Wrapper ist als Tagesclient besser als die Store-App, ganz ohne Internals.

- [x] Tray: Icon, Unread-Badge (**Quelle ist WhatsApps eigene IndexedDB**, `model-storage` → `chat`;
      Titel-Parsing nur als Rückfall), Menü (Öffnen, Einstellungen, Pausieren, DND, Autostart, Beenden)
- [x] Close-to-Tray, Autostart (optional minimiert), globaler Show/Hide-Shortcut
- [x] Taskbar-Badge: `setOverlayIcon` (Windows), `app.setBadgeCount` (macOS/Linux). Die Ziffern sind
      vorgerenderte PNGs – `nativeImage` dekodiert kein SVG und liefert dafür still ein leeres Bild
- [x] Notifications: WA-Web-Notification abfangen → native Notification; Klick ruft WhatsApps eigenen
      `onclick` auf und öffnet damit den richtigen Chat; kein Ping, wenn der Chat sichtbar und das
      Fenster fokussiert ist
- [x] Notifications bündeln: pro Chat und 3-s-Fenster ein Toast, Gesamtzähler im Tray statt Toast-Flut
- [ ] Direktantwort: macOS `hasReply`; Windows `toastXml` mit Input **spiken** – wenn nicht sauber
      machbar, Fallback: Klick öffnet Chat mit fokussiertem Eingabefeld (Senden bleibt manuell)
- [x] DND-Zeitplan (z. B. 22–7 Uhr, auch über Mitternacht) und Pausieren-Schalter im Tray
- [x] Natives Kontextmenü: Kopieren/Einfügen, Bild speichern, Link kopieren, Spellcheck-Vorschläge
- [ ] Spellcheck mit mehreren Sprachen (`setSpellCheckerLanguages(['de-DE','en-US'])`), konfigurierbar
- [x] Zoom-Stufe merken (Strg +/−/0)
- [x] CSS-Layer: Kompaktmodus, Schriftgröße, Nutzer-CSS-Datei. **Wird bei jedem `did-finish-load` neu
      injiziert** – `insertCSS` überlebt SPA-Routenwechsel, aber kein Neuladen
- [x] Declutter-Schalter: Channels, Status/„Aktuelles", Meta-AI-Button – jeweils einzeln
- [x] Enter/Shift+Enter umschaltbar (keydown-Handler im Main World, vor WhatsApps eigenem)
- [ ] Medien-Viewer-Ergänzung: Zoom/Pan per Mausrad und Tastatur im WA-Bildviewer (Injection),
      Fallback: Bild in eigenem Viewer öffnen
- [ ] Anrufe: Display-Media-Picker (`setDisplayMediaRequestHandler` + `desktopCapturer`), Quellenwahl-UI
- [ ] Audio-Ausgabegerät wählbar (setSinkId auf Media-Elemente)

**DoD:** Eine Woche Alltagsnutzung ohne Griff zur Store-App. Alle Schalter in einer Einstellungsseite.

### Phase 2 – Dateien (M)

Ziel: Dateien verhalten sich wie in einem guten Desktop-Programm.

- [x] `will-download`-Hook: kein Dialog, Pfadschema `~/Downloads/WhatsApp/<Chatname>/<YYYY-MM-DD>_<Name>`
      (Chatname aus dem UI-Layer, Fallback „Unsortiert"), Kollisionen mit Suffix, Dateizeit setzen.
      **Der Dateiname kommt aus dem Preload**, weil `getFilename()` bei Nicht-ASCII-Namen den
      Literalstring `"download"` liefert – bei deutschen Dateinamen der Normalfall
- [x] Dateinamen-Sanitizing (gemeinsames Modul für Downloads, Blob-Store, Export): verbotene Zeichen,
      reservierte Gerätenamen inkl. `CONIN$`/`CONOUT$`, keine Punkte/Leerzeichen am Ende, kein führender
      Punkt, Bidi-Override-Zeichen entfernt (Erweiterungs-Spoofing), Gesamtpfad < 240 Zeichen,
      Kürzung nach **Bytes** statt Zeichen, NFC-Normalisierung. 20 Unit-Tests
- [x] Pfadschema und Zielordner konfigurierbar; Vorschau in den Einstellungen
- [ ] Nach Download: Toast mit „Öffnen" / „Im Ordner zeigen"; Doppelklick auf Dokument-Kachel öffnet
      direkt mit der System-App (Injection: Klick abfangen → falls schon lokal vorhanden, öffnen)
- [ ] Drag-out: Dokument-Kachel aus dem Fenster in den Dateimanager ziehen (`webContents.startDrag`)
- [ ] Dedupe per SHA-256: gleiche Datei zweimal → nur ein Exemplar
- [ ] Auto-Archiv-Regeln (UI-Ebene, ohne Bridge): „In Chat X alle Dokumente automatisch speichern"
- [ ] Bilder: „Original speichern" aus dem Viewer, Sammel-Download markierter Bilder
- [ ] Drag-in/Paste-Verhalten prüfen und dokumentieren (WA Web kann das bereits)

**DoD:** 20 Dateien aus verschiedenen Chats landen ohne Interaktion korrekt sortiert; Drag-out funktioniert auf allen Ziel-OS.

### Phase 3 – Bridge & Archiv-Spiegel (L, riskantester Teil)

Ziel: Alles, was WA Web lokal hat, liegt in SQLite und wächst live mit.

- [ ] Bridge-Grundgerüst: Modulauflösung, Healthcheck, Feature-Flags, `docs/bridge-map.md`
- [ ] Datennormalisierung (`raw_json` + normalisierte Felder), Typen in `shared/`
- [ ] Archiv-Prozess: Batch-Schreiben in Transaktionen, WAL, Backpressure-Zähler (sichtbar in der UI)
- [ ] Ringpuffer in der Bridge, Batch-IPC alle ~250 ms; Import-Batches ≤ 500 mit Yield, WA Web bleibt bedienbar
- [ ] Initialer Import aller lokal vorhandenen Chats/Nachrichten/Kontakte, fortsetzbar, Fortschritt in `sync_state`
- [ ] Live-Spiegelung: neue, editierte, zurückgezogene Nachrichten; Reaktionen als eigene Kind-Einträge
- [ ] Medien-Pipeline: Download über interne Funktion → Blob-Store (content-addressed, SHA-256-Dedupe),
      Status in `media`, Index-Job anlegen
- [ ] Regeln: welche Medien automatisch geholt werden (Dokumente immer, Bilder ja, Videos ab X MB nur manuell)
- [ ] Quota für den Blob-Store mit Warnung; Speicherort in der Config, Verschieben mit Fortschritt und Verifikation
- [~] Migrations-System **fertig** (versioniert über `user_version`, je Migration eine Transaktion), alle Indizes aus §5.4 **fertig**, Schema und FTS-Trigger **fertig**; offen: `VACUUM INTO` für Snapshots
- [ ] Healthcheck-Ausfall: Banner + Features aus + Log; keine Exceptions in die WA-Seite durchreichen
- [ ] Manuelle Smoke-Test-Checkliste gegen die aktuelle WA-Web-Version (`docs/bridge-smoke.md`)
- [ ] Lasttest (§8): synthetischer Import von 5 Mio. Nachrichten und 100k Medien-Einträgen

**DoD:** Archiv entspricht nach Import dem, was WA Web anzeigt (Stichproben in 10 Chats); nach WA-Web-Update
ohne Bridge bleibt die App nutzbar und zeigt den Ausfall an; Lasttest ohne Main-Prozess-Blockaden > 16 ms,
WA Web bleibt während des Imports bedienbar.

### Phase 4 – Suche & Archivansicht (M)

Ziel: Suche und Scrollen laufen über das Archiv, nicht mehr über WA Web.

- [ ] `search_docs`/`search_fts` mit Triggern, optional Trigram-Index; Suchsyntax: Wörter, Phrasen, `from:`, `in:`,
      `before:/after:`, `has:file|image|audio|link`, `source:body|ocr|pdf|docx|transcript`
- [ ] Archiv-Panel: Chatliste, virtualisierte Nachrichtenliste mit Endlos-Scroll in beide Richtungen, Datumssprung,
      Kalender; Keyset-Pagination über `(ts, id)`, nie „alles laden"
- [ ] Trefferliste mit Kontext (±3 Nachrichten), Sprung zur Stelle im Archiv
- [ ] „Im WhatsApp-Chat öffnen": Bridge öffnet Chat und scrollt zur Nachricht (Feature-Flag, fragil)
- [ ] Medien-Galerie pro Chat (Bilder/Videos/Dokumente/Links), Filter und Sortierung
- [ ] Globale Shortcut-Suche (Strg+K) über Chats, Kontakte, Nachrichten
- [ ] Suche < 200 ms (p95) bei 5 Mio. Nachrichten und 1 Mio. Index-Dokumenten (Benchmark-Script, §8)

**DoD:** Eine beliebig alte Nachricht **aus dem Archivzeitraum** in < 5 s finden, öffnen und die Datei
daneben öffnen. Der Archivzeitraum beginnt bei der Installation plus dem, was der Erstsync liefert
([ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) A).

### Phase 5 – Erstsync und Nachziehen (S–M)

Ziel: Ab dem Installationstag geht nichts mehr verloren, und beim Verknüpfen wird mitgenommen, was
WhatsApp Web hergibt.

> **Neu gefasst am 2026-08-30.** Die ursprüngliche Fassung („so weit zurück, wie das Handy Daten
> liefert") beruhte auf einer falschen Annahme. WhatsApp Web liefert höchstens **90 Tage**; der
> Massenpfad existiert für Web-Clients nicht und wirft. Beweiskette in
> [`docs/backfill-findings.md`](docs/backfill-findings.md), Entscheidung in [ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) A.

- [ ] Erstsync: beim Verknüpfen alles spiegeln, was WhatsApps regulärer Recent-History-Sync liefert;
      Menge messen und in `docs/backfill-findings.md` nachtragen
- [ ] Inkrementelles Nachziehen pro Chat bis zum Boden: Chat öffnen, „ältere Nachrichten laden" auslösen,
      auf Eintreffen warten, wiederholen, bis nichts mehr kommt
- [ ] Drosselung: ein Chat gleichzeitig, Pausen zwischen Batches, nur bei Leerlauf und erreichbarem Handy
- [ ] Fortschritt und Zustand in `sync_state`; fortsetzbar nach Neustart; Fehler pro Chat protokolliert
- [ ] Priorisierung: Direktchats und markierte Gruppen zuerst, Chat manuell oben anstellen
- [ ] **Grenze zur Laufzeit lesen, nie hart kodieren.** `getEarliestHistorySyncDate()` liefert den Wert;
      die mautrix-Doku nennt „3 Monate" statt 90 Tage, und WhatsApp kann ihn ändern
- [ ] UI: ehrliche Fortschrittsanzeige. Kein Balken, der bei der Decke stehenbleibt und Vollständigkeit
      suggeriert – die UI nennt das erreichbare Datum und sagt, dass die Grenze von WhatsApp kommt
- [ ] `depth_limit_ts` bleibt im Schema (Begrenzung nach unten bleibt möglich), wird aber nicht mehr als
      Tiefenregler beworben – nach oben gibt es nichts zu regeln

**DoD:** Der Erstsync landet vollständig im Archiv, das Nachziehen erreicht in fünf Stichproben-Chats
nachweislich den Boden, und ein Neustart mitten im Lauf verliert nichts. Die UI zeigt dem Nutzer das
tatsächlich erreichbare Datum, nicht eine Zahl aus dem Quelltext.

### Phase 6 – Export & Backup (M)

Ziel: Das Archiv ist ein echtes, offenes Backup.

- [ ] Export pro Chat und gesamt: JSON (verlustfrei), HTML (selbständig, mit relativen Medienlinks),
      TXT im Stil des WA-eigenen Exports (`[dd.mm.yy, hh:mm] Name: Text`)
- [ ] Medien beim Export aus dem Blob-Store in lesbare Chat-Ordner materialisieren (Hardlinks, sonst Kopie)
- [ ] Inkrementeller Export (nur Neues seit letztem Lauf) und vollständiger Snapshot (`VACUUM INTO` + Blob-Store)
- [ ] Integritätsprüfung: Zähler, Hashes, Report
- [ ] Zeitgesteuerter Export in einen Zielordner (z. B. für restic/rsync)
- [ ] Dokumentation: „Restore" = Archivansicht; ein Zurückspielen in WhatsApp gibt es nicht

**DoD:** Snapshot auf zweitem Rechner in der App öffnen → alles lesbar und durchsuchbar.

### Phase 7 – Inhaltsindex: OCR, Dokumente, Transkription (M–L)

Ziel: Text in Bildern, Dateien und Sprachnachrichten ist durchsuchbar wie eine Nachricht. Alles lokal,
im Leerlauf, ohne die Bedienung zu bremsen.

- [ ] `index`-Prozess mit Job-Queue aus `index_jobs`: Prioritäten (neu vor alt, Dokumente vor Bildern),
      Retry mit Backoff, `skipped` für ungeeignete Dateien (zu groß, unbekannter Typ, Sticker)
- [ ] Leerlauf-Steuerung: nur bei Nutzer-Inaktivität und Netzstrom (Laptop), Parallelität 1–2 konfigurierbar,
      Pause-Schalter im Tray, Fortschritt in der Storage-Übersicht
- [ ] Engine-Interface (`recognize(image) → lines[]`), damit OCR-Engine austauschbar bleibt
- [ ] OCR: PP-OCRv5 über onnxruntime-node (Bibliothek laut §10), Modelle beim ersten Start nach `models/`;
      Vorverarbeitung (Skalierung auf max. Kante, Graustufen), Sprachen DE + EN; Fallback tesseract.js
- [ ] OCR-Ergebnis mit Zeilen, Boxen und Confidence nach `content_text`; Confidence-Schwelle für den Suchindex konfigurierbar
- [ ] Dokumente: PDF-Text über pdfjs-dist; Seiten ohne Textebene (Scans) rendern und durch die OCR; DOCX über mammoth;
      TXT/MD/CSV direkt; Größenlimit pro Datei; weitere Typen laut §10
- [ ] Sprachnachrichten: whisper.cpp als Sidecar, Modell laut §10, Transkript mit Zeitmarken nach `content_text`,
      Anzeige unter der Nachricht (Injection, hinter Feature-Flag)
- [ ] Suche: `source:`-Filter, Treffer zeigen Quelle und Vorschau (Bildausschnitt mit markierter Zeile, PDF-Seite,
      Zeitmarke im Audio); Klick öffnet Datei/Bild an der Stelle
- [ ] Neu-Indizierung pro Quelle: Engine + Version pro Datensatz, „mit neuem Modell neu indizieren" ohne Datenverlust
- [ ] Fixtures mit Erwartungswerten (§8): Screenshots, Rechnungen, Whiteboard-Fotos, schräge Handyfotos,
      gescanntes PDF, DOCX, kurze und lange Sprachnachricht (DE/EN)

**DoD:** Backlog von 20.000 Bildern läuft im Hintergrund durch, ohne dass die App spürbar langsamer wird;
ein Betrag aus einem fotografierten Beleg, ein Satz aus einem gescannten PDF und ein Wort aus einer
Sprachnachricht sind per Suche auffindbar und führen zur richtigen Stelle.

### Phase 8 – Erweiterungen (je S–M, frei wählbar)

- [ ] **Multi-Account:** Tabs mit getrennten Partitionen, getrennte Archive, Badge pro Account
- [ ] **App-Sperre:** PIN beim Start/Leerlauf, Fenster bei Fokusverlust weichzeichnen (Privatsphäre-Modus)
- [ ] **Chat mit Nummer:** Dialog + Registrierung als Handler für `whatsapp://` und `wa.me`-Links
- [ ] **Link-Sammlung:** alle geteilten Links pro Chat als Liste mit Titel-Vorschau
- [ ] **Erinnerungen:** „Erinnere mich an diese Nachricht" (lokal, ohne Senden)
- [ ] **Storage-Übersicht** vorziehen, falls der Cache früh wächst

### Phase 9 – Hardening & Release (M)

- [ ] Auto-Update über GitHub Releases, Session-, Archiv- und Blob-Verzeichnis vom Update unberührt (E2E-Test)
- [ ] Storage-Übersicht (Session-Cache, Archiv, Blob-Store, Modelle, Index-Queue) + selektive Bereinigung
      (Chromium-Cache ja, IndexedDB/LocalStorage nie)
- [ ] Lasttest-Suite als Release-Gate (§8): Import, Suche p50/p95, Event-Loop-Lag, Speicher, Index-Durchsatz
- [ ] Fehlerpfade: WA Web offline, Handy offline, Bridge tot, Festplatte voll, Archiv gesperrt
- [ ] Performance-Profil: RAM/CPU im Leerlauf und unter Last, Vergleich mit Store-App dokumentieren
- [ ] README (Quick Start < 5 min), `docs/architecture.md`, `docs/bridge-map.md`, Changelog
- [ ] Code-Signing: Windows – unsigniert zeigt SmartScreen „Windows hat den PC geschützt" (Ausführen über
      „Weitere Informationen → Trotzdem ausführen", braucht keine Adminrechte); Option Zertifikat/Azure Trusted
      Signing bewerten (Kosten vs. Komfort). macOS – Signierung + Notarisierung sind für ein Release Pflicht
      (Apple Developer Program), erst zum Mac-Release
- [ ] Update-E2E auf Standardbenutzer-Konto: Auto-Update von Version n auf n+1 ohne UAC, Session bleibt
- [ ] Deinstallation per-user sauber: Programmordner weg, Daten unter `%LOCALAPPDATA%` optional behalten (Abfrage)

---

## 8. Teststrategie

- **Unit (vitest):** Pfadschema, Kollisionen, Dedupe, Normalisierung, Suchsyntax-Parser, Export-Formatter.
- **Integration:** SQLite-Migrations, FTS-Trigger, Import-Batches, Backfill-State-Machine mit gefakten Bridge-Events.
- **E2E (Playwright + Electron):** App startet, lädt Login-Seite, Tray/Fenster-Verhalten, Download-Hook
  gegen lokalen Test-Server, Update lässt `session/` und `archive/` unberührt.
- **Bridge-Smoke (manuell, gated):** Checkliste gegen die aktuelle WA-Web-Version; Ergebnis wird mit
  Datum und Version in `docs/bridge-map.md` eingetragen. Läuft nie in CI (bräuchte einen echten Account).
- **Fixtures:** anonymisierte Message-JSONs für alle Nachrichtentypen (Text, Zitat, Bild, Dokument,
  Sprachnachricht, Sticker, Reaktion, Umfrage, gelöscht, editiert, Systemnachricht).
- **Last (Script + vitest):** Generator für synthetische Daten nach §3.1 (5 Mio. Nachrichten, 500 Chats,
  100k Medien-Einträge, 1 Mio. Index-Dokumente), nicht eingecheckt, reproduzierbar per Seed. Misst
  Import-Durchsatz, Suchlatenz (p50/p95), Event-Loop-Lag im Main, RSS aller Prozesse. Läuft als
  Release-Gate (Phase 9) und in der DoD der Phasen 3, 4 und 7.
- **Inhaltsindex:** Fixture-Set mit Erwartungswerten (Mindest-Trefferquote pro Fixture, erwartete Schlüsselwörter);
  Regressionstest bei Engine- oder Modellwechsel; Zeitbudget pro Fixture, damit ein Modellupdate keine Lawine auslöst.

---

## 9. Risiken & Gegenmaßnahmen

| Risiko                                                                       | Wahrscheinlichkeit                                                                                                                                        | Maßnahme                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WA-Web-Update bricht Bridge                                                  | **hoch – gemessen 9,9 WA-Web-Builds/Tag, Spitze 14** (nicht „mehrmals pro Jahr", siehe [ADR 0004](docs/decisions/0004-bridge-roaming-direktantwort.md) A) | Healthcheck, Feature-Flags, Degradation, `bridge-map.md`, Smoke-Checkliste; Modulauflösung an genau einer Stelle; Phasen 0–2 bleiben ohne Bridge vollwertig; kein Termin für Phase 3                                                                                                     |
| Account-Warnung/Sperre                                                       | niedrig bei Read-only                                                                                                                                     | Nie senden/löschen über Internals; Backfill in menschlichem Tempo; keine Massenaktionen                                                                                                                                                                                                  |
| UA-/Browser-Gate („WhatsApp funktioniert mit Chrome 60+")                    | mittel                                                                                                                                                    | Chrome-konformer UA, Chromium-Version aktuell halten                                                                                                                                                                                                                                     |
| Session-Verlust durch Update/Cache-Clear                                     | mittel                                                                                                                                                    | Partition nie anfassen, Update-E2E-Test, Bereinigung nur selektiv                                                                                                                                                                                                                        |
| Klartext-Archiv auf dem Rechner                                              | –                                                                                                                                                         | Bewusste Entscheidung; Option SQLCipher (`better-sqlite3-multiple-ciphers`) oder Verlass auf OS-Verschlüsselung (BitLocker/FileVault)                                                                                                                                                    |
| ~~Native Module (better-sqlite3) vs. Electron-Version~~                      | ~~mittel~~ **entfällt**                                                                                                                                   | better-sqlite3 13 ist N-API mit Prebuilds für alle Zielplattformen im npm-Tarball; ABI-unabhängig. Statt `electron-rebuild` nur ein CI-Smoke-Test, der eine Regression zu einem Source-Build sofort meldet (ADR 0003)                                                                    |
| ~~Backfill lädt weniger zurück als erhofft~~                                 | ~~unbekannt~~ **eingetreten, gemessen**                                                                                                                   | 90 Tage sind die Decke, der Massenpfad wirft. Phase 5 als Vorwärts-Journal neu gefasst ([ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) A; Beweise in [`docs/backfill-findings.md`](docs/backfill-findings.md)). Die Grenze wird zur Laufzeit gelesen, nie hart kodiert |
| Idee, den Windows-Gatekeeper zu fälschen, um die Decke auf ein Jahr zu heben | –                                                                                                                                                         | **Geprüft und verworfen.** Das wäre ein Schreibzugriff in WhatsApps Internals und verstößt gegen die Read-only-Regel; es meldet dem Handy zudem eine falsche Plattform                                                                                                                   |
| Notifications-Direktantwort unter Windows                                    | mittel                                                                                                                                                    | Spike in Phase 1, sauberer Fallback                                                                                                                                                                                                                                                      |
| Blob-Store frisst die Platte (viele Dateien, Videos)                         | hoch                                                                                                                                                      | Dedupe, Quota mit Warnung, Videos nur manuell, Speicherort verschiebbar (Laufwerk/NAS)                                                                                                                                                                                                   |
| OCR/Transkription bremsen den Rechner                                        | mittel                                                                                                                                                    | Leerlauf-Steuerung, Parallelität begrenzt, nur an Netzstrom, Pause im Tray                                                                                                                                                                                                               |
| Community-OCR-Ports werden nicht gepflegt                                    | mittel                                                                                                                                                    | Engine hinter Interface; onnxruntime-node und Modelle bleiben, Port ist austauschbar; tesseract.js als Fallback                                                                                                                                                                          |
| Archiv wächst über das Mengengerüst hinaus                                   | mittel                                                                                                                                                    | Vorgaben §3.1, Lasttest als Release-Gate, Keyset-Pagination, external-content-FTS; bei Bedarf Archiv nach Jahr partitionieren                                                                                                                                                            |
| Index-Lawine nach Modellwechsel                                              | niedrig                                                                                                                                                   | Neu-Indizierung pro Quelle, gedrosselt, mit Zeitbudget; alte Ergebnisse bleiben bis zum Ersatz gültig                                                                                                                                                                                    |
| Firmen-Policy (AppLocker/SRP) blockiert Ausführen aus `%LOCALAPPDATA%`       | unbekannt                                                                                                                                                 | In Phase 0 auf dem echten Zielrechner testen; Ausweg: signiertes Paket oder IT-Freigabe – dann früh wissen, nicht in Phase 9                                                                                                                                                             |
| Roaming-Profil synchronisiert Gigabytes                                      | mittel (Domänen-Konto)                                                                                                                                    | Alle Daten nach `%LOCALAPPDATA%` (Phase 0), Prüfung im Installer-Test                                                                                                                                                                                                                    |
| SmartScreen-Warnung schreckt ab / Defender verdächtigt unsignierte Sidecars  | mittel                                                                                                                                                    | Dokumentierter Klickweg; Signierung als Option in Phase 9; Sidecars aus offiziellen Releases mit Hash-Prüfung                                                                                                                                                                            |
| Windows-Pfadlänge/Dateinamen brechen Downloads oder Export                   | mittel                                                                                                                                                    | Sanitizing-Modul (Phase 2), Tests mit Extremfällen                                                                                                                                                                                                                                       |
| macOS wird nebenbei kaputtgebaut                                             | mittel                                                                                                                                                    | mac-Build ist Pflicht-Check in CI; `platform/`-Interface; keine Windows-API im Feature-Code                                                                                                                                                                                              |

---

## 10. Entscheidungen (geklärt am 2026-08-30)

Alle Punkte sind in [`docs/decisions/0001-offene-entscheidungen-aus-plan-10.md`](docs/decisions/0001-offene-entscheidungen-aus-plan-10.md)
mit Begründung und Konsequenzen festgehalten. Kurzfassung:

| #   | Punkt                  | Entscheidung                                                                                                                                                                                |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ziel-OS                | Windows 10/11 zuerst (Release), macOS ab Phase 0 in CI grün, Linux nicht geplant. Installation ohne Adminrechte ist Pflicht.                                                                |
| 2   | Archiv-Verschlüsselung | Klartext als Default, DB-Anbindung hinter einem Interface, Umstieg auf SQLCipher später ohne Schema-Migration möglich.                                                                      |
| 3   | Medien-Archiv          | Bilder und Dokumente immer automatisch; **Videos nur auf Klick**; **Sprachnachrichten nicht automatisch**, auf Klick holbar.                                                                |
| 4   | Transkription          | whisper.cpp **on demand** statt Backlog. Modell `small` als Standard, `turbo-q5_0` als Genauigkeits-Option, keine GPU ([ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) D). |
| 5   | Repo und Lizenz        | Repo `phish3144/watis`, Paket/Ordner `watis`, `productName` `WatIs`, UI-Name `WatIs?`, **MIT**, öffentlich.                                                                                 |
| 6   | Downloadordner         | `~/Downloads/WhatsApp/<Chatname>/`, konfigurierbar.                                                                                                                                         |
| 7   | OCR-Bibliothek         | Offen – Spike gegen die Fixtures entscheidet. Bis dahin nur über das Engine-Interface, `tesseract.js` als Fallback.                                                                         |
| 8   | Dateitypen im Index    | PDF, DOCX, TXT/MD/CSV **plus gescannte PDFs durch die OCR**. Kein XLSX/PPTX (Interface bleibt offen).                                                                                       |
| 9   | Blob-Store             | Systemlaufwerk, `%LOCALAPPDATA%\watis\blobs`, Startquote **20 GB**, Warnung ab 80 %, Ort verschiebbar.                                                                                      |
| 10  | Backfill-Tiefe         | **Überholt.** WhatsApp Web liefert höchstens 90 Tage; Phase 5 ist ein Vorwärts-Journal ([ADR 0005](docs/decisions/0005-backfill-medien-transkription.md) A).                                |
| 11  | Windows-Signierung     | Unsigniert, SmartScreen-Klickweg dokumentiert – Vorbehalt: AppLocker-Test in Phase 0.                                                                                                       |
| 12  | Zielrechner            | **Verwalteter Firmenrechner.** Installer-Test auf dem echten Zielgerät ist ein Phase-0-Task, kein Phase-9-Task.                                                                             |

Konsequenzen, die den Plan an anderer Stelle ändern:

- **§4 Punkt 12 und Phase 7:** Die Transkription ist kein Hintergrundläufer mehr. Der Index-Prozess
  verarbeitet OCR und Dokumenttext im Leerlauf; Transkription läuft nur auf Anforderung und darf dann
  sofort rechnen.
- **§3.1:** Das Mengengerüst für Medien sinkt spürbar, weil Videos und Sprachnachrichten nicht automatisch
  eingesammelt werden. Die Vorgaben für Nachrichten, Chats und Index-Jobs bleiben unverändert gültig.
- **Phase 0:** Der Installer-Test auf dem verwalteten Zielrechner wird zum ersten Task mit Ergebnis, nicht
  zum letzten. Scheitert er an AppLocker, wird Punkt 11 neu aufgemacht.

---

## 11. Arbeitsvereinbarungen für Claude Code

- Dieses Dokument zuerst vollständig lesen. Phasen in Reihenfolge; keine Phase überspringen.
- Pro Task ein Commit (Conventional Commits), pro Phase ein PR/Branch. Checkboxen hier abhaken.
- Jede Änderung mit Tests, wo sinnvoll. Bridge-Code wird zusätzlich in `docs/bridge-map.md` dokumentiert.
- **Niemals** Code schreiben, der über Internals sendet, löscht, blockiert oder Kontakte/Gruppen ändert –
  auch nicht als Experiment, auch nicht hinter einem Flag.
- Neue Dependencies mit nativen Modulen oder > 1 MB nur nach Rückfrage.
- Bei Unsicherheit über einen internen WA-Web-Store: erst Healthcheck-Test schreiben, dann Feature.
- Architekturentscheidungen als kurze ADRs unter `docs/decisions/`.
- Keine Telemetrie, keine Netzwerkaufrufe außer zu web.whatsapp.com/WA-Medienservern und GitHub Releases (Updater).
- Sendecode existiert an genau einer Stelle (Direktantwort, ADR 0004 C). Nirgendwo sonst wird getippt,
  geklickt oder abgeschickt.
- Wenn eine Aufgabe etwas voraussetzt, das in §10 noch offen ist: nachfragen, nicht raten.
- Performance-Budget: kein Code im Main-Prozess, der länger rechnet als ein paar Millisekunden oder synchron
  auf Platte/DB wartet – das gehört in die `utilityProcess`-Instanzen. Listen werden virtualisiert und
  paginiert. §3.1 ist bindend; Abweichungen nur mit ADR.
- OCR-, PDF- und Whisper-Code nur hinter dem Engine-Interface; keine direkte Kopplung an eine Bibliothek.
- Nichts, was Adminrechte braucht: keine Dienste, keine HKLM-Registry, keine Treiber, keine offenen Ports,
  keine Schreibzugriffe außerhalb von `%LOCALAPPDATA%`, dem Download-Ordner und vom Nutzer gewählten Pfaden.
  Installer und Updater müssen auf einem Standardbenutzer-Konto durchlaufen.
- Keine Windows-API direkt im Feature-Code: alles über `platform/`; jede Windows-Implementierung bekommt
  im selben PR eine macOS-Implementierung oder einen dokumentierten Stub. Der mac-Build muss grün bleiben.
- Pfade nie zusammenkleben: `path.join`, `app.getPath`, Sanitizing-Modul. Keine Annahmen über `\` oder `C:`.

---

## 12. Kickoff-Prompt

```
Lies PLAN.md vollständig. Wir beginnen mit Phase 0. Kläre vorher die offenen Punkte aus §10, die
Phase 0 betreffen (Repo-Name, Punkt 12 Zielrechner). Ziel-OS ist entschieden: Windows zuerst, macOS
wird mitgebaut, Installation ohne Adminrechte. Lege dann das Projektgerüst an, arbeite die Tasks von
Phase 0 der Reihe nach ab und hake sie in PLAN.md ab. Halte dich an §11.
```
