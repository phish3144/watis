# Bridge-Smoke-Test

Manuelle Checkliste gegen die aktuelle WA-Web-Version. **Läuft nie in CI** — sie braucht ein echtes,
angemeldetes Konto, und dafür gibt es in einem öffentlichen Repository keinen Platz.

Ergebnis mit Datum und Version in [`docs/bridge-map.md`](bridge-map.md) nachtragen.

## Vorbereitung

1. WatIs? starten, QR scannen, warten bis die Chatliste steht.
2. Entwicklerwerkzeuge im WhatsApp-View öffnen (Ansicht → Entwicklerwerkzeuge).
3. WA-Web-Version notieren: in der Konsole `require('WAWebVersion')` oder aus dem `<meta>`-Tag.

## Prüfungen

| #   | Prüfung                                                                       | Erwartung                                             |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | `typeof window.require`                                                       | `"function"`                                          |
| 2   | `require('WAWebChatCollection').ChatCollection.getModelsArray().length`       | > 0                                                   |
| 3   | `require('WAWebMsgCollection').MsgCollection`                                 | Objekt mit `get`                                      |
| 4   | `require('WAWebContactCollection').ContactCollection.getModelsArray().length` | > 0                                                   |
| 5   | `require('WAWebHistorySyncUtils').getEarliestHistorySyncDate()`               | Datum oder Zahl, grob 90 Tage zurück                  |
| 6   | Healthcheck im Log beim Start                                                 | `ok: true`, keine `failures`                          |
| 7   | Chat über die Archivansicht öffnen                                            | richtiger Chat, richtige Stelle                       |
| 8   | **Nachziehen an einem Chat starten**                                          | Ältere Nachrichten erscheinen, Fortschritt zählt hoch |
| 9   | Nachziehen abbrechen und neu starten                                          | Fortsetzung, kein Neubeginn                           |

## Was ausdrücklich mitgeprüft wird

- **Lesebestätigung.** Nach Prüfung 7: Wurde der Chat auf dem Handy als gelesen markiert? Das ist der
  erwartete, in [ADR 0006](decisions/0006-lesebestaetigung-beim-chatoeffnen.md) akzeptierte Fall — aber
  er gehört gesehen, nicht angenommen.
- **Nichts wird gesendet.** `logs/outgoing.log` muss nach dem gesamten Durchlauf leer sein.
- **Kein Ausfall bricht die Seite.** Ein absichtlich falscher Modulname im Healthcheck darf nur die
  betroffene Funktion abschalten, nicht WhatsApp Web stören.
