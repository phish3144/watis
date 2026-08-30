# WatIs? – Arbeitsanweisungen

Ein Desktop-Client, der `web.whatsapp.com` in Electron hostet und drumherum baut, was die offizielle App
nicht kann: lokales durchsuchbares Archiv, vernünftige Dateibehandlung, echte Desktop-Integration.

## Zuerst lesen

1. **[`PLAN.md`](PLAN.md)** – der verbindliche Entwicklungsplan. Vollständig lesen, bevor irgendetwas
   angefasst wird. Phasen werden in Reihenfolge abgearbeitet, Checkboxen dort gepflegt.
2. **[`docs/decisions/`](docs/decisions/)** – ADRs. `0001` hält die Antworten auf alle Punkte aus
   PLAN.md §10 fest.

## Namen (nicht verwechseln)

| Ebene | Wert |
|---|---|
| Repository, npm-Paket, Ordner unter `%LOCALAPPDATA%`, AppUserModelId | `watis` |
| `productName` – Installer, Startmenü, Programmordner | `WatIs` |
| Anzeigename in UI, Fenstertitel, Über-Dialog | `WatIs?` |

Das Fragezeichen gehört ausschließlich in Anzeige-Strings. Es darf **nie** in einen Pfad, Dateinamen,
Registry-Schlüssel oder Build-Artefaktnamen geraten – `?` ist unter Windows verboten.

## Harte Regeln

Diese sind nicht verhandelbar. Ein PR, der eine davon verletzt, ist falsch, auch wenn er funktioniert.

### Read-only gegenüber WhatsApp

- **Niemals** Code, der über die Internals sendet, löscht, blockiert, Kontakte oder Gruppen ändert,
  Nachrichten als gelesen markiert oder Status postet. Auch nicht als Experiment, auch nicht hinter einem
  Feature-Flag, auch nicht auskommentiert.
- Erlaubt sind: lesen, beobachten, Medien laden, aktuellen Chat ermitteln, Chat öffnen, zu einer Nachricht
  scrollen, „ältere Nachrichten laden" auslösen – letzteres in menschlichem Tempo.
- Kein Protokoll-Client (whatsmeow, Baileys). Kein Scheduling, keine Bots, kein Bulk, kein Auto-Reply.

### Keine Adminrechte

- Keine Dienste, keine Treiber, keine HKLM-Registry, keine lauschenden Ports, keine systemweiten
  Installationen. Auch nicht für Updates oder Sidecars.
- Schreibzugriffe nur unter `%LOCALAPPDATA%\watis\`, im Download-Ordner und in vom Nutzer gewählten Pfaden.
- Zielrechner ist ein **verwalteter Firmenrechner**: AppLocker/SRP und Roaming-Profile sind reale Risiken,
  keine theoretischen.

### Main-Prozess rechnet nicht

- Kein synchroner Platten- oder DB-Zugriff im Main-Prozess. Archiv (SQLite) und Inhaltsindex (OCR, PDF,
  Whisper) laufen als eigene `utilityProcess`-Instanzen.
- Main blockiert nie länger als 16 ms. Der Event-Loop-Lag-Watchdog meldet Verstöße ins Log.
- Batches statt Einzelschreibvorgängen. Ringpuffer statt eines IPC-Calls pro Nachricht.
- Alle Listen paginiert und virtualisiert. „Alles laden" gibt es nicht.
- §3.1 in PLAN.md ist bindend. Abweichungen nur mit ADR.

### Plattformabstraktion

- Keine OS-spezifischen Aufrufe im Feature-Code. Alles über `platform/`.
- Jede Windows-Implementierung bekommt **im selben Commit** eine macOS-Implementierung oder einen
  dokumentierten Stub. Der macOS-Build in CI muss grün bleiben.
- `CommandOrControl` statt `Ctrl`. `path.join` und `app.getPath` statt zusammengeklebter Pfade.
  Keine Annahmen über `\` oder `C:`.

### Session ist heilig

- Persistente Partition `persist:wa`. Storage wird nie gelöscht. Cache-Bereinigung nur selektiv
  (HTTP-Cache, GPUCache, Code Cache – **nie** IndexedDB, LocalStorage, Service-Worker-Registrierungen).
- Das Archiv liegt außerhalb des Webview-Storage. Ein Re-Link oder Cache-Clear darf es nicht anfassen.
- Der Updater fasst `session/`, `archive/` und `blobs/` nicht an. Das wird per E2E-Test bewiesen.

### Datenschutz und Netz

- Keine Telemetrie, kein Crash-Upload, keine Cloud, keine externen Dienste. Auch OCR und Transkription
  laufen lokal.
- Netzwerkverkehr nur zu `web.whatsapp.com` / WhatsApp-Medienservern und zu GitHub Releases (Updater).
  Modell-Downloads sind die einzige Ausnahme und passieren nur nach ausdrücklicher Nutzeraktion.
- Keine echten Nachrichten, Telefonnummern oder Screenshots mit Inhalten im Repository. Fixtures sind
  anonymisiert.

## Arbeitsweise

- **Ein Commit pro Task**, Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
  Ein Branch/PR pro Phase.
- Checkbox in `PLAN.md` im selben Commit abhaken, in dem der Task fertig wird.
- Architekturentscheidungen als kurzes ADR unter `docs/decisions/`, fortlaufend nummeriert.
- Bridge-Code wird zusätzlich in `docs/bridge-map.md` dokumentiert: aufgelöstes Modul, Feldnamen, und die
  WA-Web-Version, gegen die es verifiziert wurde.
- **Neue Dependencies mit nativen Modulen oder > 1 MB nur nach Rückfrage.** Lizenz prüfen – das Projekt ist
  MIT und öffentlich.
- Bei Unsicherheit über einen internen WA-Web-Store: erst einen Healthcheck-Test schreiben, dann das
  Feature.
- Wenn eine Aufgabe etwas voraussetzt, das nicht entschieden ist: nachfragen, nicht raten.

## Sprache

- Code, Bezeichner, Kommentare, Commit-Messages, Dateinamen: **Englisch**.
- UI-Texte, Dokumentation, ADRs: **Deutsch**. Die UI ist von Anfang an i18n-fähig gebaut.

## Tests

- Unit (vitest): Pfadschema, Kollisionen, Dedupe, Normalisierung, Suchsyntax-Parser, Export-Formatter.
- Integration: SQLite-Migrationen, FTS-Trigger, Import-Batches, Backfill-State-Machine mit gefakten Events.
- E2E (Playwright + Electron): Start, Fenster-/Tray-Verhalten, Download-Hook gegen lokalen Test-Server,
  Update lässt `session/` und `archive/` unberührt.
- Bridge-Smoke: manuelle Checkliste gegen die aktuelle WA-Web-Version. Läuft nie in CI (bräuchte einen
  echten Account). Ergebnis mit Datum und Version in `docs/bridge-map.md`.
- Der Lasttest nach §3.1 ist Release-Gate und Teil der DoD von Phase 3, 4 und 7.
