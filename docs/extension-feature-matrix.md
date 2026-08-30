# Was WatIs? als Browser-Erweiterung noch kann

_Stand 2026-08-30. Grundlage: fünf Recherchebereiche gegen [`PLAN.md`](../PLAN.md), jeder anschließend
adversarisch gegengeprüft, plus die eigenen Messungen aus [`extension-spike.md`](extension-spike.md)._

Die Frage ist nicht akademisch: Auf dem verwalteten Zielrechner läuft die unsignierte EXE nicht. Eine
eigenständige Web-App ist ausgeschlossen — `web.whatsapp.com` verbietet das Einbetten
(`frame-ancestors`), und die Same-Origin-Policy verbietet den Rest. Bleibt Code **innerhalb** der Seite,
also eine Erweiterung.

## Bilanz

113 einzelne PLAN-Punkte bewertet. **Vorbehalt zur Belastbarkeit:** Die anschließende Gegenprüfung hat
72 tragende Behauptungen geprüft und davon nur 26 unverändert bestätigt — 16 widerlegt, 22 als zu
optimistisch, 8 als zu pessimistisch. Die Zahlen unten stammen aus der Erstrecherche; die materiellen
Revisionen stehen im Abschnitt [Korrekturen](#korrekturen-aus-der-gegenprüfung) und sind dort
eingearbeitet, aber nicht in die Tabelle zurückgerechnet. Sie zeigt also die Größenordnung, nicht eine
belastbare Punktzahl.

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
existiert nur, solange `web.whatsapp.com` offen ist.** Wie hart das trifft, hängt an der Bauform des
Fensters — siehe [Korrekturen](#korrekturen-aus-der-gegenprüfung).

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

Das ist der Punkt, an dem sich der Spike bezahlt gemacht hat. Die Gegenprüfung führte genau diese Frage
als offenes Architekturrisiko: Chromes COEP-Manifestseite zählt die betroffenen Kontexte auf
(„service worker, popup, options page, tabs …") und nennt Offscreen Documents **nicht**, und der
einschlägige öffentliche Thread endet ungelöst. Dokumentiert ist es also nicht — gemessen schon.

Und der Einsatz ist höher, als er zunächst aussah: Nicht nur Phase 7 hängt daran. SQLite-WASM schreibt
zur Standard-OPFS-Persistenz _„JavaScript's SharedArrayBuffer type is required for the OPFS VFS, and that
class is only available if the web server includes the so-called COOP and COEP response headers."_ COI
trägt damit auch die Phasen 3 bis 5. Falls es in einer künftigen Chrome-Version wegfällt, existiert ein
Ausweg: die **OpfsSAHPool**-VFS-Variante braucht kein COOP/COEP, arbeitet aber mit exklusiver Sperre auf
einem vorab allozierten Dateipool — Archiv-Writer und Index-Writer könnten dann nicht gleichzeitig
dieselbe DB offen halten. Beide Wege gehören in den ADR.

Das Store-Paket darf **2 GB** groß sein, Modelle im Paket sind also grundsätzlich möglich. Mehr sollte
man daraus vorerst nicht machen: Die Grenze bei Edge Add-ons ist nicht dokumentiert — und der Zielrechner
ist ein verwalteter Firmenrechner, auf dem oft Edge läuft —, die Reviewdauer für ein Paket von mehreren
hundert MB ist unbekannt, und ob Chrome differenziell aktualisiert ebenso; sonst lädt jeder
Versionssprung dasselbe halbe Gigabyte neu.

Auch die kursierenden Modellgrößen für PP-OCRv5 (4,7 / 16,5 MB) sind **nicht** verwendbar: das sind
Paddle-Inferenzdateien (`.pdiparams`), und im HuggingFace-Repo liegt keine einzige `.onnx`-Datei.
Zwischen der Zahl und einem lauffähigen Modell liegt eine ungetestete paddle2onnx-Konvertierung. Für den
OCR-Pfad ist damit nicht nur das Setup offen, sondern das Modellartefakt selbst.

whisper.cpp als **Sidecar ist nicht tot** — das war ein Fehlschluss. `chrome.runtime.connectNative`
existiert, und Chrome startet Native-Messaging-Hosts ausdrücklich als eigenen Prozess; die Registrierung
darf unter `HKEY_CURRENT_USER` liegen, also ohne Adminrechte. Die echte Einschränkung ist eine andere:
Das Binary darf nicht im CRX liegen, sondern braucht einen eigenen Installer — womit die Erweiterung
ihren größten Vorteil auf dem verwalteten Rechner verliert. Das ist eine Produktentscheidung, keine
technische Grenze, und gehört in einen ADR.

whisper.wasm als Ersatz ist schwächer als gedacht: seit Emscripten 3.1.58 wird der pthread-Worker in die
Haupt-JS eingebettet und per Blob-URL erzeugt — und Blob-Worker sind unter der Extension-CSP gesperrt
(`worker-src` fällt auf `script-src 'self'` zurück). **transformers.js/WebGPU gehört damit als Primärweg
geführt, nicht als gleichrangige Alternative.**

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
| Dateizeit setzen                        |   2   | Weder `chrome.downloads` noch File System Access können das                        |
| Speicherort des Archivs/Blob-Stores     |   3   | OPFS ist origin-privat und liegt im Chrome-Profil. Kein NAS, kein zweites Laufwerk |
| whisper.cpp als Sidecar                 |   7   | Eine Erweiterung startet keine Prozesse                                            |
| Medien-Entschlüsselung selbst nachbauen |   3   | Möglich, aber Netzverkehr an der App vorbei — Geist von „kein Protokoll-Client"    |
| Drag-out unter Linux                    |   2   | `PrepareDragForDownload` steht unter `#if BUILDFLAG(IS_WIN)`                       |

**Close-to-Tray** verdient eine eigene Zeile, weil beide naheliegenden Antworten falsch sind. Die
`background`-Permission hält _„Chrome … shut down late (even after its last window is closed)"_ — am
Leben bleibt aber nur der **Browserprozess**, nicht der Tab und auch nicht der Service Worker: der wird
weiterhin nach 30 s Leerlauf beendet, die Permission steht nicht in der Liste der lebensverlängernden
Mechanismen. Mit dem letzten Fenster verschwindet das Content Script, also der Archivierer. Konsequenz
für den Entwurf: Zähler, DND-Fenster und jeder Zustand müssen in `chrome.storage` liegen — globale
Variablen überleben nicht —, und alles Laufende muss ereignisgetrieben oder per `chrome.alarms` getaktet
sein, mit 30 s als kleinster Auflösung.

**Autostart** hängt am selben Faden und ist schlimmer: Der Login-Eintrag über die `background`-Permission
ist im Chromium-Code `IS_WIN`-only, nicht bloß die Policy. Auf macOS entsteht dort kein Stub, sondern ein
Loch — was direkt gegen die Projektregel „jede Windows-Implementierung bekommt im selben Commit eine
macOS-Implementierung oder einen dokumentierten Stub" läuft. Plattformneutral ist stattdessen die
`WebAppSettings`-Policy mit `run_on_os_login` (ab Chrome 102, macOS eingeschlossen).

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

## Korrekturen aus der Gegenprüfung

Vier Revisionen sind wichtig genug, um sie eigens zu nennen — drei davon machen die Bilanz **besser**.

### „Verpasse keine Nachricht" ist doch versprechbar — als App-Fenster, nicht als Tab

Der zunächst notierte harte Blocker gilt nur für den Tab. Auf einem verwalteten Rechner steht die
`WebAppSettings`-Policy zur Verfügung, und dort heißt es zu `run_on_os_login`: _„If this field is set to
`run_windowed`, the web app will run during OS login and the user will not be able to disable this
later."_ Seit Chrome 117 kommt `prevent_close_after_run_on_os_login` dazu — das Fenster lässt sich dann
_„by the user, task manager, web APIs"_ nicht mehr schließen. Zusammen: WhatsApp Web startet beim Login
als eigenes Fenster und bleibt offen, auf Windows **und** macOS.

Das ist derselbe IT-Vorgang wie die Extension-Allowlist, also kein zusätzlicher Antragstyp. Restlücken
bleiben — `DiscardReason::EXTERNAL` und `FROZEN_WITH_GROWING_MEMORY` umgehen jeden Schutz.

### Freezing ist ein zweiter, eigener Mechanismus

Die Discard-Schutzliste (Anpinnen, `autoDiscardable: false`, `TabDiscardingExceptions`) deckt **Freezing
nicht ab** — das hat eine eigene `CannotFreezeReason`-Aufzählung. Davon greifen für uns nur die erteilte
Notification-Berechtigung und die Opt-out-Liste. Übersehen worden war ein dritter Hebel:
`kHoldingWebLock` — eine Seite, die einen Web Lock hält, kann nicht eingefroren werden, und das sind aus
dem Content Script drei Zeilen. Edge verschärft die Lage: dort kann das System _„freeze (sleep) tabs
before discarding them"_.

### Der Taskbar-Badge ist doch erreichbar

Nicht über eine Extension-API — die gibt es nicht —, aber über die App-Badging-API, sobald
`web.whatsapp.com` als App installiert ist (per Hand oder per `WebAppInstallForceList`). Sie funktioniert
_„on Windows, and macOS, in Chrome 81 and Edge 81 or later"_, verlangt aber ein installiertes
App-Fenster. Der Preis: Im App-Fenster gibt es keine Toolbar, also kein `chrome.action`-Icon und kein
Popup — die Bedien-UI müsste in eine Extension-Seite oder ein In-Page-Overlay wandern. Urteil also
**eingeschränkt**, nicht „nein".

### Die selektive Cache-Bereinigung aus Phase 9 geht wörtlich

`chrome.browsingData.remove({ origins: ['https://web.whatsapp.com'] }, { cache: true })` leert den
HTTP-Cache origin-selektiv, ohne IndexedDB, LocalStorage oder Service-Worker-Registrierungen zu berühren
— genau die Phase-9-Anforderung. Preis: die weitreichende `browsingData`-Permission, die im Store-Review
teuer werden kann. GPUCache und Code Cache sind nicht einzeln adressierbar.

### Und eine Warnung zur Quellenlage

In einem der fünf Rechercheberichte waren die beiden tragendsten Chromium-Belege mit einer **erfundenen
Domain** zitiert (`chromiumcodesearch.example` — `.example` ist nach RFC 2606 reserviert). Die
Gegenprüfung hat die Inhalte an den echten Fundstellen auf `chromium.googlesource.com` nachgewiesen, die
Aussagen stimmen also. Aber vor einer Architekturentscheidung gehört jedes Chromium-Zitat in diesem
Dokument mit Commit- oder Branch-Angabe neu verankert.

Offen und für Phase 1 tragend: **ob WhatsApp Web `window.Notification` benutzt oder
`ServiceWorkerRegistration.showNotification()`.** Im Electron-Client ersetzen wir `Notification` im Main
World, und das funktioniert — ein starkes Indiz, aber in der Erweiterung nicht nachgemessen. Drei
Phase-1-Funktionen (Bündelung, DND, „kein Ping bei sichtbarem Chat") hängen daran.

## Empfehlung

Die Erweiterung ist keine Notlösung, sondern die Bauform, die zum Zielrechner passt. **92 % der Punkte
überleben** in irgendeiner Form, das Archiv mit Volltextsuche eingeschlossen — und der Teil, der stirbt,
ist fast vollständig Desktop-Integration, nicht Funktion.

Der sinnvolle Zuschnitt ist ein **gemeinsamer Kern** (Bridge-Leser, Archiv-Schema, FTS-Logik,
Normalisierung) mit zwei Schalen.

Was nicht versprochen werden darf, ist genau ein Satz: **„läuft im Tray, auch wenn ich den Browser
zumache."** Der stimmt nicht und lässt sich auch nicht reparieren.

„Verpasse keine Nachricht" dagegen war im ersten Durchgang zu Unrecht abgeschrieben: Als per Policy
installiertes, nicht schließbares App-Fenster hält die Zusage weitgehend — mit den benannten Restlücken.
Auf einem verwalteten Rechner ist das derselbe IT-Vorgang wie die Freigabe der Erweiterung selbst.

Bevor gebaut wird, sind drei Dinge zu klären, und alle drei sind kleine Experimente statt Recherche:
ob WhatsApp Web `window.Notification` oder `showNotification()` benutzt (drei Phase-1-Funktionen hängen
daran); ob `Cmd.openChatAt` Lesebestätigungen auslöst (die Read-only-Regel hängt daran); und ob sich der
IndexedDB-Zugriff sowie die Modulauflösung in einer angemeldeten Sitzung bestätigen.
