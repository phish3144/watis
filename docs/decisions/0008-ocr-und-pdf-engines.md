# ADR 0008 – Tesseract für OCR, pdf.js für Dokumente, Whisper vertagt

- **Status:** akzeptiert
- **Datum:** 2026-08-31
- **Betrifft:** PLAN.md Phase 7, §10; ersetzt die dortige Vorentscheidung für PP-OCRv5
- **Ersetzt teilweise:** [ADR 0001](0001-offene-entscheidungen-aus-plan-10.md), Punkt zur OCR-Engine

## Entscheidung

| Zweck         | Gewählt                   | Größe  | Lizenz     |
| ------------- | ------------------------- | ------ | ---------- |
| OCR           | `tesseract.js` 7.0.0      | 1,7 MB | Apache-2.0 |
| OCR-Laufzeit  | `tesseract.js-core`       | 44 MB  | Apache-2.0 |
| Sprachdaten   | `tessdata_fast` deu + eng | 5,6 MB | Apache-2.0 |
| PDF           | `pdfjs-dist` 6.3.289      | 35 MB  | Apache-2.0 |
| DOCX          | **offen**                 | –      | –          |
| Transkription | **vertagt**               | –      | –          |

Alle gewählten Lizenzen sind mit MIT verträglich.

## Warum Tesseract statt PP-OCRv5

PLAN.md §10 und ADR 0001 hatten PP-OCRv5 über `onnxruntime-node` vorgesehen — genauer auf Fotos und
Belegen. Dagegen sprachen bei der Umsetzung zwei Dinge:

1. **Es gibt kein einsatzfähiges Modellartefakt.** Die kursierenden Größenangaben (4,7 MB Detektion,
   16,5 MB Erkennung) beziehen sich auf Paddle-Inferenzdateien (`.pdiparams`); im HuggingFace-Repo
   liegt keine einzige `.onnx`-Datei. Zwischen der Zahl und einem lauffähigen Modell liegt eine
   ungetestete `paddle2onnx`-Konvertierung.
2. **`onnxruntime-node` ist ein natives Modul.** Das bringt genau das Rebuild-Problem zurück, das
   ADR 0003 mit better-sqlite3 gerade losgeworden ist.

Tesseract ist auf Fotos messbar schwächer. Der Ausgleich: Es läuft heute, ohne native Module und ohne
Modellkonvertierung. Das Engine-Interface bleibt, damit PP-OCRv5 später ohne Schemaänderung nachrücken
kann — `content_text` führt Engine und Version pro Datensatz, eine Neu-Indizierung greift nur die eine
Quelle an.

## Zwei Regelverstöße, die wir vermieden haben

**Kein Nachladen von Sprachdaten.** `tesseract.js` holt `.traineddata` per Default von einem CDN. Das
verstößt gegen „keine externen Dienste". Die Dateien liegen deshalb unter `resources/tessdata/` und
`langPath` zeigt dorthin; `gzip: false`, weil wir die ungepackte Form ausliefern.

**Kein CDN für den pdf.js-Worker.** `GlobalWorkerOptions.workerSrc` wird über `require.resolve` auf den
mitgelieferten Build gesetzt. Ein nackter Paketname in `new URL(...)` wird als _relativer Pfad_
behandelt und landet neben der eigenen Datei — der Fehler kostet einen Testlauf und wäre in Produktion
ein stiller Griff ins Netz gewesen.

## Der Preis

**44 MB Laufzeit für Tesseract.** `tesseract.js-core` liefert alle WASM-Varianten (SIMD, relaxed-SIMD,
LSTM-only) aus und wählt zur Laufzeit. Sie zu filtern würde auf manchen CPUs die schnelle Variante
entfernen, deshalb bleiben alle drin. Zusammen mit pdf.js wächst der Installer um grob 80 MB.

## Whisper vertagt

Die Transkription bleibt vorerst weg. Der Grund ist nicht Größe allein, sondern dass beide Wege
zusätzliche Entscheidungen verlangen: whisper.cpp als Sidecar-Binary widerspricht „nichts außerhalb
`%LOCALAPPDATA%`", und `transformers.js` mit dem small-Modell sind ~250 MB, die irgendwo herkommen
müssen. `classify()` leitet Audio weiterhin nach `transcript`, und die Queue legt die Jobs an — sie
finden nur noch keine Engine und werden übersprungen. Nachrüsten ist eine Datei.

## DOCX offen

`mammoth` (2,2 MB, BSD-2) wäre der naheliegende Weg, ist aber nicht freigegeben. Bis dahin
klassifiziert `classify()` `.docx` weiterhin als eigene Quelle; die Jobs bleiben ohne Engine.

## Belegt

Beide Engines laufen gegen erzeugte Fixtures (`scripts/make-ocr-fixture.mjs`,
`scripts/make-pdf-fixtures.mjs`, Inhalte erfunden):

- **OCR** liest „München", „Straßenweg" und „1.249,90" aus einem gerenderten Bild, mit Zeilenboxen,
  in unter einer Sekunde.
- **PDF** extrahiert den Textlayer inklusive Umlauten, gruppiert die von pdf.js gelieferten Fragmente
  anhand ihrer vertikalen Position zu Zeilen — ohne das kommt eine zweispaltige Rechnung wortweise
  verschränkt heraus — und meldet eine Seite **ohne** Textlayer als `scannedPages` statt als leer.
  Ein Scan ist kein Dokument ohne Wörter, sondern ein Bild von Wörtern, und gehört in die OCR-Queue.
