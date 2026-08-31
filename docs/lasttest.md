# Lasttest und Release-Gate

Verlangt von PLAN.md §8. Zwei Kommandos:

```
npm run verify         # Sekunden. Läuft bei jedem Commit.
npm run gate:release   # Minuten. Läuft vor einem Tag.
```

`gate:release` fasst zusammen: `verify`, ein vollständiger Build, die E2E-Suite und der Lasttest.
Ein Exit-Code. Ein Schritt, der durch ein Signal stirbt, meldet `status: null` — das zählt hier als
Fehlschlag, nicht als Erfolg. Genau diese Verwechslung lässt sonst ein rotes Gate durch.

## Was der Lasttest misst

Er importiert synthetische Nachrichten durch **das ausgelieferte Repository**, nicht durch
handgeschriebenes SQL — ein Gate, das eine Kopie misst, kann leise von dem abweichen, was Nutzerinnen
bekommen. Die Bundles dafür baut `scripts/build-loadtest.mjs`; vorher wurden sie von Hand erzeugt und
`out/` ist gitignored, das Gate lief auf einem frischen Clone also gar nicht.

```
npm run loadtest:archive                    # 500 000 Nachrichten
node scripts/loadtest-archive.mjs 5000000   # die Zahl aus dem Plan, ~2 GB Platte
```

Jeder Lauf schreibt `loadtest-report.json`, damit sich eine Release-Notiz auf einen Lauf berufen kann
und nicht auf die Erinnerung an einen.

## Die Schwellen

| Gate             | Grenze           | Wovor sie schützt                                                                      |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------- |
| Suche p95        | ≤ 200 ms         | Eine alte Nachricht zu finden muss sich sofort anfühlen, egal wie groß das Archiv ist  |
| Paging p95       | ≤ 50 ms          | Nach oben scrollen ist Keyset-Paging; es darf mit der Chatlänge nicht langsamer werden |
| Import-Batch p95 | ≤ 250 ms         | Ein Batch ist eine Transaktion im Worker                                               |
| Import-Durchsatz | ≥ 3 500 Zeilen/s | Der Erstsync muss in Minuten fertig sein, nicht an einem Abend                         |
| Index-Queue      | ≥ 500 Jobs/s     | Die Queue selbst darf nie der Engpass sein — die Engines sind langsam genug            |
| Prozess-RSS      | ≤ 1 024 MiB      | Das Archiv wird geblättert und gestreamt; es im Speicher zu halten hebt das auf        |

**Die Grenzen stehen dort, wo sie stehen, weil gemessen wurde — nicht umgekehrt.** Gemessen auf dem
Entwicklungsrechner (Container, geteilte CPU), 500 000 Nachrichten, 10 000 Medien:

|                            |                                                     |
| -------------------------- | --------------------------------------------------- |
| Import                     | 63,8 s → **7 833 Zeilen/s**                         |
| Batch p95                  | 99,6 ms (schlechtester 304 ms — ein WAL-Checkpoint) |
| Suche p95 (neueste zuerst) | **6,62 ms**                                         |
| Suche p95 (Relevanz)       | 629 ms                                              |
| Paging p95                 | 0,30 ms                                             |
| Datenbank                  | 180 MiB                                             |
| RSS                        | 189 MiB                                             |

Der Durchsatz-Grenzwert liegt bei rund der Hälfte des Gemessenen. Das fängt eine echte Halbierung ab,
ohne auf einer langsameren CI-Maschine falschen Alarm zu schlagen.

**Gemessen wird der Batch-p95, nicht der schlechteste Batch.** SQLite schreibt das WAL periodisch
zurück; dieser eine Batch dauert ein Vielfaches der Nachbarn. Das ist ein reales Verhalten und keine
Regression — auf das Maximum zu gaten hieße, darauf zu gaten, wann der Checkpoint zufällig fällt.

## Die Relevanz-Sortierung verfehlt das Gate — mit Ansage

629 ms bei 500 000 Nachrichten. Das ist bauartbedingt und in
[ADR 0007](decisions/0007-suchreihenfolge-und-zeitgeordnete-rowid.md) festgehalten: Nach bm25 zu
sortieren heißt, **alle** Treffer zu bewerten, bevor der erste feststeht. Bei einem sehr häufigen
Begriff sind das Hunderttausende. Die Standardreihenfolge — neueste zuerst — liest dagegen über die
zeitgeordnete rowid nur so weit, wie sie muss, und bleibt deshalb im einstelligen Millisekundenbereich.

Deswegen gatet der Lasttest die Standardreihenfolge und meldet die Relevanz-Zahl daneben, statt sie
zu verstecken oder das Gate so weit aufzumachen, dass es nichts mehr aussagt.
