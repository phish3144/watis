# Was WatIs? als Browser-Erweiterung noch kann

_Stand 2026-08-30. Grundlage: fünf Recherchebereiche gegen [`PLAN.md`](../PLAN.md), jeder anschließend
adversarisch gegengeprüft, plus die eigenen Messungen aus [`extension-spike.md`](extension-spike.md)._

Die Frage ist nicht akademisch: Auf dem verwalteten Zielrechner läuft die unsignierte EXE nicht. Eine
eigenständige Web-App ist ausgeschlossen — `web.whatsapp.com` verbietet das Einbetten
(`frame-ancestors`), und die Same-Origin-Policy verbietet den Rest. Bleibt Code **innerhalb** der Seite,
also eine Erweiterung.

## Bilanz

113 einzelne PLAN-Punkte bewertet:

| Urteil                  | Anzahl | Anteil |
| ----------------------- | -----: | -----: |
| **voll** — gleichwertig |     64 |   57 % |
| **eingeschränkt**       |     40 |   35 % |
| **nein**                |      7 |    6 % |
| **ungeklärt**           |      2 |    2 % |

| Phase                           |  n  | voll | eingeschr. | nein |
| ------------------------------- | :-: | :--: | :--------: | :--: |
| 1 – Hülle & Desktop-Integration | 18  |  11  |     6      |  1   |
| 2 – Dateien                     | 16  |  7   |     7      |  2   |
| 3 – Bridge & Archiv-Spiegel     | 25  |  15  |     7      |  3   |
| 4 – Suche & Archivansicht       |  7  |  5   |     2      |  0   |
| 5 – Erstsync und Nachziehen     |  4  |  3   |     1      |  0   |
| 6 – Export & Backup             |  7  |  3   |     4      |  0   |
| 7 – Inhaltsindex                | 25  |  17  |     5      |  1   |
| 8 – Erweiterungen               |  5  |  2   |     3      |  0   |
| 9 – Hardening & Release         |  6  |  1   |     5      |  0   |

Der teuerste Verlust steht nicht in dieser Tabelle, weil er keine einzelne Zeile ist: **die Erweiterung
existiert nur, solange ein Tab mit `web.whatsapp.com` offen ist.**

## Die vier tragenden Befunde

### 1. Die Bridge trägt — gemessen, nicht vermutet

`world: "MAIN"` wird auf `web.whatsapp.com` trotz Nonce-CSP ausgeführt. Eigener Messwert (siehe
[`extension-spike.md`](extension-spike.md)), unabhängig belegt durch CSP Level 3 §9.1 („Chrome … does
some work to ensure that extension-driven injections are allowed, regardless of a page's policy") und
den Chromium-Pfad `script_injection.cc` → `RequestExecuteScript` → `ClassicScript::CreateUnspecifiedScript`,
der nie eine CSP konsultiert.

Und der Einstieg ist einfacher als im Electron-Client: WA Web nutzt kein webpack mehr, sondern Metas
`__d`-System. Der Loader setzt `window.require` als echtes Seiten-Global — Modulauflösung ist ein
Einzeiler, `moduleRaid` entfällt, `require("__debug").modulesMap` ist der Healthcheck-Index.

Was die Seiten-CSP sehr wohl verbietet, ist alles **danach**: kein `eval`, kein `new Function`, kein
nachgeladenes `<script>`. Der Bridge-Code muss statisch gebündelt ausgeliefert werden. Für uns kein
Verlust.

### 2. Das Archiv ist sicher — bis auf die Deinstallation

`unlimitedStorage` befreit OPFS ausdrücklich von Quota. Wichtiger ist der Eviction-Pfad:
`QuotaDatabase::GetBucketsForEviction()` überspringt alles, was `IsStorageUnlimited()` erfüllt, und der
Kommentar in `special_storage_policy.h` sagt wörtlich _„Unlimited storage is not subject to quota or
storage pressure eviction."_ „Browserdaten löschen" und `ClearBrowsingDataOnExitList` erreichen
`chrome-extension://`-Origins nicht. Nur `PostUninstallExtension()` löscht.

Gemessen: OPFS mit `createSyncAccessHandle` läuft im Worker eines Offscreen Documents, 256 MB
geschrieben und zurückgelesen. SQLite-WASM bringt FTS5 **und** Trigram mit. Der Aufschlag gegenüber
better-sqlite3 liegt bei Abfragen bei 1,6–2×, beim Massen-Insert bei 4,4×. Das 200-ms-Ziel aus §3.1
scheitert daran nicht — es scheitert an unbegrenztem `ORDER BY bm25()` (294 ms bei 200.000 Treffern
gegenüber 0,68 ms mit `LIMIT`), und das ist im Electron-Client genauso.

Harte Decke: **2 GiB WASM-Heap.** `exportFile()` liest die ganze DB dorthin — Backup muss streamen.

### 3. Phase 7 verliert weniger als befürchtet

Cross-Origin-Isolation ist per Manifest bestellbar (`cross_origin_embedder_policy` +
`cross_origin_opener_policy`). Selbst gemessen: im Offscreen Document `crossOriginIsolated === true`,
`SharedArrayBuffer` allokiert, geteilter `WebAssembly.Memory` funktioniert. **WASM-Threads sind da.**

Und das Store-Paket darf **2 GB** groß sein. Damit passen alle Modelle hinein — PP-OCRv5 mobile 4,7 +
16,5 MB, tessdata_fast deu/eng 1,53 + 4,11 MB, whisper-small int8 ~249 MB. Die Regel „keine externen
Dienste" lässt sich strenger einhalten als im Electron-Client, der die Modelle nachlädt.

Tot ist nur whisper.cpp als Sidecar — eine Erweiterung startet keine Prozesse. Ersatz ist whisper.wasm
oder transformers.js/WebGPU; für `small` gibt es keine belastbare WASM-Zahl, das README nennt „x2 or x3
real-time" nur für `tiny` und `base`.

### 4. Ein Fund, der auch den Electron-Client betrifft

Die Gegenprüfung hat einen Regelverstoß gefunden, der nichts mit der Bauform zu tun hat:
**Einen Chat zu öffnen löscht den Unread-Zähler und sendet Lesebestätigungen.** CLAUDE.md verbietet
„Nachrichten als gelesen markiert" ausdrücklich, und `Cmd.openChatAt` steht in PLAN.md Phase 4 und 5 als
erlaubte Operation. Das ist ein Widerspruch im Plan selbst, nicht in der Erweiterung — er gehört
geklärt, bevor Phase 4 gebaut wird.

Nebenbefund gleicher Güte: `require('WAWebCmd')` liefert ein Objekt, das auch `sendStarMsgs`,
`sendDeleteMsgs`, `sendRevokeMsgs` und `Revoke` trägt. Die Read-only-Regel wird damit zur reinen
Disziplinfrage — es gibt keine technische Schranke. Und `loadEarlierMsgs` nimmt ein Feld `trigger`, das
auf `USER_SCROLL` defaultet: automatisierter Backfill meldet sich an WhatsApps Telemetrie als
Nutzer-Scrollen. Das gehört bewusst entschieden, nicht geerbt.

## Was ersatzlos wegfällt

| Punkt                                   | Phase | Warum                                                                              |
| --------------------------------------- | :---: | ---------------------------------------------------------------------------------- |
| Tray-Icon im Infobereich                |   1   | Keine API. Ersatz: `chrome.action.setBadgeText`, ~4 Zeichen, nur in der Toolbar    |
| Taskbar-Badge                           |   1   | Keine Extension-API adressiert das OS-Icon des Browsers                            |
| Dateizeit setzen                        |   2   | Weder `chrome.downloads` noch File System Access können das                        |
| Speicherort des Archivs/Blob-Stores     |   3   | OPFS ist origin-privat und liegt im Chrome-Profil. Kein NAS, kein zweites Laufwerk |
| whisper.cpp als Sidecar                 |   7   | Eine Erweiterung startet keine Prozesse                                            |
| Medien-Entschlüsselung selbst nachbauen |   3   | Möglich, aber Netzverkehr an der App vorbei — Geist von „kein Protokoll-Client"    |
| Drag-out unter Linux                    |   2   | `PrepareDragForDownload` steht unter `#if BUILDFLAG(IS_WIN)`                       |

**Close-to-Tray** verdient eine eigene Zeile, weil die naheliegende Antwort falsch ist: Die
`background`-Permission hält _„Chrome … shut down late (even after its last window is closed)"_ — aber
am Leben bleibt der Browserprozess samt Service Worker, **nicht der Tab**. Mit dem letzten Fenster
verschwindet das Content Script, also genau der Archivierer.

## Was besser wird

Ehrlicherweise gehört das genauso in die Bilanz:

- **Der gesamte Auslieferungsaufwand entfällt.** Kein Code-Signing, kein SmartScreen, kein NSIS, kein
  UAC, kein `%LOCALAPPDATA%`-Layout, kein electron-updater, keine macOS-Notarisierung. Das sind die
  teuersten Posten aus Phase 0 und 9 — und der Grund, warum wir hier überhaupt sitzen.
- **Mehrsprachige Rechtschreibprüfung, Bildschirmfreigabe-Picker, Zoom-Persistenz und Kontextmenü macht
  der Browser nativ.** Vier PLAN-Punkte, die schlicht entfallen. Electron brauchte
  `setDisplayMediaRequestHandler` nur, weil Electron keinen Picker hat.
- **Die Session ist das Browserprofil.** Die Regel „Session ist heilig" mit ihrem
  Cache-Bereinigungs-Regelwerk wird gegenstandslos.
- **Downloads sind sauberer**: `chrome.downloads` nimmt Unterordner und `conflictAction: "uniquify"`
  direkt entgegen, `onDeterminingFilename` ersetzt `will-download` exakt — und ohne den `getFilename()`-
  Fehler bei nicht-ASCII-Namen, um den wir im Electron-Client herumbauen mussten.
- **Der CSS-Layer flackert nicht mehr**, weil Content-Script-CSS vom Browser injiziert wird und von der
  Seiten-CSP unberührt bleibt.
- **Das Ressourcenziel ist erfüllt**, weil es buchstäblich ein Chrome-Tab ist.

## Offene Punkte

- **`chrome.runtime`-Messaging ist JSON, nicht strukturierter Klon** (außer mit
  `"message_serialization": "structured_clone"`, Chrome 148+). `ArrayBuffer`, `Blob`, `Map`, `Set`,
  `Date` überleben nicht. Medienbytes müssen über `window.postMessage` oder base64 — trifft die
  Medien-Pipeline und den Ringpuffer direkt.
- **Timer-Drosselung im Hintergrundtab**: Nach 5 Minuten verborgen fällt ein 250-ms-Intervall auf 1/min.
  Der Batch-IPC-Takt aus §3.1 muss anders getrieben werden.
- **`chrome.idle` gibt es im Content Script nicht** — Leerlauf muss im Service Worker ermittelt und
  weitergereicht werden.
- **Tab-Discarding**: `TabDiscardingExceptions` schützt wirksam (derselbe IT-Vorgang wie die
  Extension-Allowlist), aber nicht absolut — `DiscardReason::EXTERNAL` greift bedingungslos.
- Nicht gemessen, weil es eine angemeldete Sitzung braucht: der IndexedDB-Zugriff, die tatsächliche
  Modulauflösung und ob `Cmd.openChatAt` wirklich Lesebestätigungen auslöst.

## Empfehlung

Die Erweiterung ist keine Notlösung, sondern die Bauform, die zum Zielrechner passt. **92 % der Punkte
überleben** in irgendeiner Form, das Archiv mit Volltextsuche eingeschlossen — und der Teil, der stirbt,
ist fast vollständig Desktop-Integration, nicht Funktion.

Der sinnvolle Zuschnitt ist ein **gemeinsamer Kern** (Bridge-Leser, Archiv-Schema, FTS-Logik,
Normalisierung) mit zwei Schalen. Was nicht versprochen werden darf: „läuft im Tray, auch wenn ich den
Browser zumache", und „verpasse keine Nachricht". Beides sollte offen benannt und nicht wegdefiniert
werden.
