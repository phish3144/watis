# Architektur

Wie WatIs? gebaut ist und warum an den Stellen, wo das nicht offensichtlich ist. Der verbindliche
Plan steht in [`PLAN.md`](../PLAN.md); dieses Dokument beschreibt, was tatsächlich im Code steht.

## Prozesse

```
┌──────────────────────── Electron main ────────────────────────┐
│  Fenster, Tray, Benachrichtigungen, Downloads, Updater        │
│  Bridge-Host · Importer · Backfill · Medien-Fetcher           │
│  Rechnet nicht. Hält keinen DB-Handle. Blockiert nie > 16 ms. │
└───────┬───────────────────────┬───────────────────┬───────────┘
        │ WebContentsView       │ utilityProcess    │ utilityProcess
┌───────▼──────────┐  ┌─────────▼─────────┐  ┌──────▼──────────┐
│ web.whatsapp.com │  │ archive           │  │ contentIndex    │
│ + Preload        │  │ SQLite (WAL) FTS5 │  │ OCR, PDF, Queue │
│ + Bridge (Seite) │  │ Blob-Store        │  │ liest dieselbe  │
└──────────────────┘  │ Export, Backup    │  │ Datei, migriert │
                      └───────────────────┘  │ nie             │
┌──────────────────┐                         └─────────────────┘
│ Eigenes Panel    │
│ React, Preload   │
└──────────────────┘
```

**Der Main-Prozess rechnet nicht.** `better-sqlite3` ist synchron: Wer den Handle hält, steht
während einer langen Abfrage still. Deshalb liegt die Datenbank in einem eigenen Prozess und Main
schickt nur Nachrichten hin und her. Ein Event-Loop-Watchdog meldet jede Blockade über 16 ms ins Log.

**Genau ein Prozess besitzt das Schema.** Der Archiv-Worker migriert, der Inhaltsindex hängt sich an
und prüft nur die Version. Als beide migrierten, scheiterte der zweite gelegentlich beim Start ohne
erkennbares Muster — eine deferred Transaktion, die auf eine Schreibsperre hochstuft, während die
andere sie hält, rettet auch `busy_timeout` nicht. Festgehalten in
`test/integration/schema-ownership.test.ts`.

## Die drei Welten

WhatsApp Web lädt in einer `WebContentsView` mit `contextIsolation` und `sandbox`. Drei getrennte
JavaScript-Kontexte, die sich nur das DOM teilen:

| Welt         | Was dort läuft                   | Was sie darf                                                      |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| **Seite**    | WhatsApps Bundle + unsere Bridge | `window.require`, WhatsApps Interna — **read-only**               |
| **Isoliert** | `preload/wa.ts`                  | `ipcRenderer`, IndexedDB der Origin; relayt, liest aber nicht mit |
| **Main**     | Bridge-Host, Importer            | alles Node — aber nie einen WhatsApp-Objektgraph                  |

Die Bridge muss in der Seitenwelt laufen, weil `window.require` nur dort existiert. Sie kommt als
eine IIFE ohne Imports und ohne Node-Builtins herein, injiziert nach **jedem** `did-finish-load` —
WhatsApp Web lädt sich nach Logout, Update und längerem Socket-Verlust selbst neu.

Zwischen Seite und Main liegt ein `CustomEvent` mit einem **JSON-String**. Kein structured clone:
der würde lebende Referenzen aus der Seite heraustragen, ein String kann das nicht. Nichts im
Main-Prozess kann dadurch versehentlich an ein WhatsApp-Modell geraten und etwas darauf aufrufen.

Details und die geprüften Modulsignaturen: [`bridge-map.md`](bridge-map.md).

## Datenfluss

```
WhatsApp-Collection  ──on('add')──▶  Bridge (Seite)
                                       │ bündelt 250 ms, max. 2000 wartend
                                       ▼
                                    Preload ──IPC──▶ Importer (Main)
                                                       │ Ringpuffer, verwirft statt zu wachsen
                                                       │ Batches à 500, alle 250 ms
                                                       ▼
                                                  Archiv-Worker
                                                  ├─ messages, chats, media
                                                  ├─ search_docs ──trigger──▶ search_fts
                                                  └─ blobs/ (SHA-256, dedupliziert)
                                                       │
                                                       ▼
                                                  index_jobs ──▶ Inhaltsindex
                                                                 OCR / PDF ──▶ content_text
```

**Beide Puffer verwerfen, statt zu wachsen.** Ein stehender Worker muss eine zählbare Lücke kosten,
keinen Absturz wegen vollem Speicher — und die Zähler stehen im Panel, weil eine Lücke, die niemand
sieht, dem Archiv angelastet wird.

## Suche

`search_docs` ist die einzige Quelle des Volltextindex; `search_fts` ist eine FTS5-External-Content-
Tabelle darüber, gefüllt über Trigger. Im Index steht die **normalisierte** Form (ADR 0002), im
Original bleibt der Text: `Grüße` und `Gruesse` finden einander, aber angezeigt wird immer das, was
tatsächlich geschrieben wurde.

Die Standardreihenfolge ist **neueste zuerst** und zieht ihre Kandidaten allein aus `search_fts`
über eine **zeitgeordnete rowid** — die rowid kodiert den Zeitstempel, also liest die Abfrage nur so
weit, wie sie muss. 6,6 ms p95 bei 500 000 Nachrichten. Die Relevanzsortierung bewertet dagegen
jeden Treffer, bevor der erste feststeht, und verfehlt das Gate bauartbedingt
([ADR 0007](decisions/0007-suchreihenfolge-und-zeitgeordnete-rowid.md), [`lasttest.md`](lasttest.md)).

Jede Liste ist paginiert und virtualisiert. Über `(ts, id)` als Keyset, nie über `OFFSET`.
„Alles laden" gibt es nicht.

## Was schiefgehen darf

`shared/health/degraded.ts` bildet jede Störung auf genau die Fähigkeiten ab, die sie kostet — und
auf keine weitere. Die Bridge zu verlieren stoppt das Wachsen des Archivs, lässt das Vorhandene aber
durchsuchbar. **Lesen wird nie abgeschaltet:** Fällt der Wrapper aus, läuft WhatsApp Web in seiner
View weiter, und die Nutzerin den Messenger zu kosten, weil unser Worker gestorben ist, ist das eine
Ergebnis, gegen das hier ausdrücklich entworfen wurde.

## Wo nichts hinkommt

- **Nutzdaten** nur unter `%LOCALAPPDATA%\watis\`, im Download-Ordner und in gewählten Pfaden.
  Nie ins Roaming-Profil, nie nach HKLM, nie in `%ProgramFiles%`.
- Das Update ersetzt den **Programmordner**; der Datenbaum liegt woanders und bleibt byteweise
  unberührt. Belegt in `test/e2e/update.spec.ts`.
- Netzverkehr nur zu WhatsApp und zu GitHub Releases. Die einzige Ausnahme ist das
  Rechtschreib-Wörterbuch, und das lädt Chromium erst, nachdem die Nutzerin eine Sprache gewählt hat
  — die Einstellungsseite sagt das dazu.

## Plattform

Alles OS-Spezifische liegt hinter `platform/`. Jede Windows-Implementierung bekommt im selben Commit
eine macOS-Implementierung oder einen dokumentierten Stub; der macOS-Build in CI bleibt grün.
Feature-Code ruft nie direkt eine Windows-API auf.
