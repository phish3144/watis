# ADR 0007 – Suchreihenfolge: neueste zuerst, mit zeitgeordneter Rowid

- **Status:** akzeptiert
- **Datum:** 2026-08-31
- **Betrifft:** PLAN.md §5.4 (`search_docs`), §8 (Lasttest), Phase 4

## Problem

PLAN.md Phase 4 verlangt „Suche < 200 ms (p95) bei 5 Mio. Nachrichten". Die erste Umsetzung sortierte
nach `bm25()` und verfehlte das schon bei einem Fünftel der Datenmenge.

Gemessen mit dem ausgelieferten Code (`scripts/loadtest-archive.mjs`), 200.000 Nachrichten:

| Anfrage                     | Treffer | `ORDER BY bm25()` | `ORDER BY d.ts DESC` | nur FTS, `ORDER BY rowid DESC` |
| --------------------------- | ------: | ----------------: | -------------------: | -----------------------------: |
| `"Vorgang"`                 | 200.000 |         120,24 ms |             48,29 ms |                    **0,09 ms** |
| `"Rechnung"`                |  40.000 |          45,40 ms |             21,16 ms |                        0,10 ms |
| `("München" OR "Muenchen")` |  26.667 |          30,74 ms |             16,66 ms |                        0,17 ms |
| `"Rechnung" AND "Termin"`   |       0 |           0,94 ms |              1,01 ms |                        0,02 ms |

Die Kosten hängen an der **Trefferzahl**, nicht am Ranking: Jede Sortierung, die `search_docs`
mitliest, zwingt SQLite dazu, alle Treffer in einen Temp-B-Tree zu materialisieren
(`USE TEMP B-TREE FOR ORDER BY`). Weder ein Index auf `search_docs(ts)` noch ein Zeitfenster ändern
daran etwas — beide werden erst **nach** dem FTS-Scan angewandt (nachgemessen: 21–23 ms in allen
Varianten).

Nur eine Anfrage bricht früh ab: die, die **ausschließlich** `search_fts` anfasst und nach `rowid`
sortiert. FTS5 läuft dann seine Doclist rückwärts und hört beim `LIMIT` auf.

## Entscheidung

**Zwei Dinge, die zusammengehören.**

### 1. Die Rowid von `search_docs` wird aus dem Zeitstempel abgeleitet

`rowid = ts * 2^20 + n`, wobei `n` der nächste freie Platz innerhalb derselben Sekunde ist. Damit ist
absteigende Rowid-Reihenfolge **genau** „neueste zuerst".

Der naheliegende Autoincrement hätte Importreihenfolge bedeutet — und die läuft nach einem Backfill
(Phase 5 zieht ältere Nachrichten später nach) der Zeitreihenfolge entgegen. Die Sortierung wäre dann
still falsch gewesen, was schlimmer ist als langsam.

Eine Sekunde fasst 2^20 Dokumente, bevor sie in die nächste überliefe; ein Chat-Archiv kommt dem nicht
nahe, und der Fehler wäre eine Sekunde Reihenfolge.

### 2. „Neueste zuerst" ist die Standardreihenfolge und nimmt den schnellen Weg

`ArchiveRepository.search()` zieht die Kandidaten aus `search_fts` allein, absteigend, und wendet die
Filter batchweise darauf an, bis die Seite voll ist. Relevanz-Sortierung bleibt verfügbar, ist aber
nicht der Standard.

## Ergebnis

Gemessen durch das Repository, nicht durch handgeschriebenes SQL:

| Datenmenge          | neueste zuerst p95 | Relevanz p95 | Pagination p95 | Import    |
| ------------------- | -----------------: | -----------: | -------------: | --------- |
| 200.000 Nachrichten |        **1,44 ms** |    101,31 ms |        0,14 ms | 19.100 /s |
| 1.000.000           |        **6,20 ms** |    524,07 ms |        0,16 ms | 15.700 /s |

Von 100 ms auf 1,44 ms bei gleicher Datenmenge — Faktor 70.

## Konsequenzen

- **Das 200-ms-Gate aus §8 gilt für die Standardreihenfolge.** Relevanz-Sortierung verfehlt es bei
  sehr häufigen Begriffen und wird das immer tun: Ein Ranking über 200.000 Treffer muss alle 200.000
  ansehen. Das ist kein Fehler, sondern der Preis der Funktion, und die UI muss ihn benennen, statt
  ihn zu verstecken.
- Der ehrliche Schlechtestfall des schnellen Wegs ist ein Filter, der fast alle Kandidaten verwirft
  (`in:` auf einen winzigen Chat plus ein sehr häufiges Wort). Dann arbeitet er sich in wachsenden
  Batches durch und landet beim Aufwand, den der langsame Weg immer hat.
- `search_docs.rowid` ist damit **bedeutungstragend** und darf nie neu vergeben werden. Ein
  `VACUUM` lässt explizite Rowids in Ordnung; `VACUUM INTO` für Snapshots (Phase 3) ebenfalls.
- Der Import kostet ~16.000 Zeilen/s, weil jede Zeile durch die FTS-Trigger und die Normalisierung
  läuft. Ein Batch von 500 blockiert den Archiv-Prozess dabei bis zu 257 ms. Das ist zulässig — die
  16-ms-Regel aus §3.1 gilt dem Main-Prozess —, aber es begrenzt, wie schnell ein Erstsync sein kann.
