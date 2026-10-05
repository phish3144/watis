# ADR 0012 – Texterkennung und Transkription im Browser

- **Status:** akzeptiert
- **Datum:** 2026-10-02
- **Betrifft:** PLAN.md Phase 7 und Phase 10; [ADR 0001](0001-offene-entscheidungen-aus-plan-10.md) §4
  (Transkription auf Klick)
- **Ergänzt:** [ADR 0008](0008-ocr-und-pdf-engines.md). Dieselben Engines, im Browser geladen. Dessen
  „Whisper vertagt" ist **für die Browser-Erweiterung** aufgehoben, für den Desktop nicht.
- **Vorgabe der Nutzerin:** „OCR und Transkribieren sind wichtig". whisper.cpp als WASM, Modelle aus
  einem eigenen GitHub-Release (beides am 2026-10-02 so gewählt).

## Texterkennung und PDF-Text

Dieselben Bibliotheken und dieselbe Engine-Schnittstelle wie am Desktop (`OcrRouter`,
`ScannedPdfEngine`, `storeExtraction`). Sie laufen im Archiv-Worker, neben der Datenbank, in die die
Ergebnisse gehen.

| Zweck         | Gewählt                                                | Im Paket                                            |
| ------------- | ------------------------------------------------------ | --------------------------------------------------- |
| OCR           | tesseract.js 7, Kern `tesseract-core-simd-lstm` (WASM) | ≈ 11 MB mit Sprachdaten deu + eng und pdf.js-Worker |
| PDF-Textebene | pdf.js 6.3 (legacy build)                              | im Bundle                                           |
| Gescannte PDF | Seiten mit `OffscreenCanvas` gerendert, dann OCR       | –                                                   |

Drei Dinge sind im Browser anders als am Desktop:

- **Nur der SIMD-Kern.** Jeder unterstützte Browser (Chrome und Edge ab 116, Firefox ab 128) hat
  WASM-SIMD. Die drei Rückfallvarianten würden das Paket verdreifachen, und niemand bräuchte sie.
- **Kein Worker aus einer `blob:`-URL** (`workerBlobURL: false`). Die CSP der Erweiterung verbietet
  ihn. pdf.js bekommt seinen Worker als `workerPort` übergeben, weil es im Worker kein Fenster zum
  Vergleichen der Herkunft findet und sonst auf demselben Thread parst, der auch die Suche
  beantwortet.
- **Der legacy build von pdf.js.** Der moderne braucht `Map.prototype.getOrInsertComputed`, das
  Chromium 141 noch nicht hat.

Alles liegt im Paket, nichts kommt zur Laufzeit von einem CDN.

## Transkription

**whisper.cpp als WASM**, über `@transcribe/shout` 1.0.7 und `@transcribe/transcriber` 3.0.1
(beide MIT, whisper.cpp ebenfalls MIT). Auf Klick an einer Sprachnachricht, eine nach der anderen.
Das Ergebnis geht als `content_text` mit Quelle `transcript` und Zeitmarken ins Archiv und ist
sofort suchbar (`quelle:transcript`).

### Wo es läuft – und warum dort

whisper.cpp braucht zwei Dinge, die nur eine Seite hat: einen `AudioContext`, um Opus zu
dekodieren, und `SharedArrayBuffer` für seine Threads. Letzteren gibt es nur in einer
**cross-origin-isolierten** Seite. Gemessen am 2026-10-02:

| Seite                        | Chromium 141 | Firefox 157 |
| ---------------------------- | ------------ | ----------- |
| Panel (Erweiterungsseite)    | isoliert     | **nicht**   |
| Archiv-Frame im WhatsApp-Tab | nicht        | isoliert    |

Chromium isoliert Erweiterungsseiten über die Manifest-Schlüssel `cross_origin_*`. Firefox
ignoriert sie. Dafür schickt WhatsApp dem echten Firefox `Cross-Origin-Opener-Policy: same-origin`
und Chromium `same-origin-allow-popups` plus eine `Document-Isolation-Policy`. Ein `curl` mit dem
User-Agent des jeweiligen Browsers bekommt keins von beiden; gemessen ist es mit den echten
Browsern. Daraus folgt:

- **Chrome, Edge:** whisper.cpp läuft im Panel.
- **Firefox:** whisper.cpp läuft im Archiv-Frame des WhatsApp-Tabs. Das Panel fragt über den Relay
  an, der Frame schreibt das Transkript in das Archiv, das er hält. Der WhatsApp-Tab muss dafür
  offen sein, und die Einstellungen sagen das.

Beides teilt sich ein Modul (`src/extension/whisper.ts`). Die nachgebaute WhatsApp-Seite der
E2E-Tests liefert die Header pro Browser so, wie sie gemessen wurden, denn genau sie entscheiden,
was wo läuft.

Die Emscripten-Hülle (`whisper/shout.wasm.js`, 1,5 MB samt eingebettetem WASM) liegt als eigene
Datei im Paket und wird nicht gebündelt. Ihre Threads starten Worker über die eigene URL, und eine
gebündelte Kopie würde auf einen `blob:`-Worker ausweichen, den die CSP verbietet.

### Modelle

| Name im UI | Modell                | Größe  | SHA-256 (Anfang) |
| ---------- | --------------------- | ------ | ---------------- |
| Schnell    | `ggml-base-q5_1.bin`  | 57 MB  | `422f1ae4…`      |
| Genau      | `ggml-small-q5_1.bin` | 181 MB | `ae85e4a9…`      |

Die vollständigen Prüfsummen stehen in `src/extension/whisper-models.json`. Die Modelle stehen unter
MIT (Whisper-Gewichte von OpenAI, ggml-Konvertierung von whisper.cpp).

- **Nicht im Paket.** Geladen wird einmal, auf Klick, mit Größenangabe vorab.
- **Ein Klick an der Sprachnachricht (2026-10-05).** Ist noch kein Modell da, bietet
  „Transkribieren“ direkt an der Sprachnachricht „Schnell“ (57 MB) an. Erst der zweite Klick auf
  „Laden und transkribieren“ lädt es; danach wird sofort umgewandelt, und eine Sprachnachricht, die
  noch nicht im Archiv ist, wird dabei geholt. „Schnell“, weil der erste Eindruck Sekunden statt
  Minuten dauern soll. „Genau“ bleibt in den Einstellungen; ist es da, nimmt WatIs? dieses.
- **Aus dem eigenen GitHub-Release `whisper-models`**, nicht von einem persönlichen
  Hugging-Face-Konto. `scripts/mirror-whisper-models.mjs` holt die Dateien aus whisper.cpps eigenem
  Repository, prüft sie und gibt die `gh`-Befehle aus. Hochladen ist ein bewusster Schritt einer
  Maintainerin. **Das Release ist ein Prerelease**, weil der Desktop-Updater nach dem neuesten
  Release fragt und eines, das nur Modelle trägt, nie finden darf.
- **Die Berechtigung kommt erst beim Klick.** Die Download-Hosts von GitHub sind
  `optional_host_permissions` und werden erst beim Klick auf „Herunterladen" erfragt (CLAUDE.md:
  Modell-Downloads nur nach ausdrücklicher Nutzeraktion).
- **Geprüft vor Gebrauch.** Der Download landet als `.part`, wird gegen Größe und SHA-256 geprüft
  und erst dann umbenannt.
- **Ohne GitHub:** Ist GitHub im Firmennetz gesperrt, lässt sich dieselbe Datei von der Platte
  wählen. Welches Modell es ist, folgt aus der Größe, ob es stimmt, aus der Prüfsumme.

### Sprache

Einstellbar, **Deutsch als Voreinstellung**. „Automatisch" lässt whisper.cpp seinen Encoder zweimal
laufen: einmal, um die Sprache zu raten, einmal für die Transkription. Der Encoder ist bei kurzen
Nachrichten fast die ganze Rechenzeit (gemessen: zwei gleich lange Durchgänge).

### Was es kostet – gemessen, und wo noch nicht

In der Cloud-VM dieser Entwicklung (4 vCPU Xeon, Chromium headless, Modell „Schnell",
4,4 Sekunden Sprache) dauerte eine Transkription 33 bis 75 Sekunden mit 3 Threads und 84 Sekunden
mit einem. Fast alles davon ist der Encoder, der immer ein 30-Sekunden-Fenster rechnet; kurze
Nachrichten kosten deshalb kaum weniger als halbminütige. Die Threads helfen also, die Maschine ist
langsam und schwankt stark. **Auf einem echten Arbeitsplatzrechner ist das noch nicht gemessen**,
und dort ist die Zahl zu erheben, bevor das Release etwas über die Dauer verspricht.

Ein geladenes Modell bleibt zwei Minuten im Speicher, damit eine Reihe von Nachrichten es nur einmal
lädt. Es nutzt alle Kerne bis auf einen (höchstens sechs).

## Folgen

- Paketgröße je Browser rund 17 MB, davon etwa 11 MB OCR und 1,5 MB whisper.cpp.
- Das Release `whisper-models` muss einmal angelegt werden, bevor der Download-Knopf funktioniert.
  Bis dahin geht nur der Weg über die Datei.
- Die Desktop-App transkribiert weiterhin nicht (ADR 0008). Derselbe WASM-Weg ginge dort im Renderer
  und wäre die naheliegende Wahl, wenn das Thema dort wieder aufkommt.
