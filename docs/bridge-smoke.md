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

## Medien holen (unbelegt)

`WAWebDownloadManager.downloadManager.downloadAndMaybeDecrypt` ist die einzige Signatur im Projekt,
die **nicht** gegen ein laufendes Bundle geprüft wurde. Bis dieser Punkt einmal grün war, gilt das
Medienholen als unbelegt.

- [ ] `require('WAWebDownloadManager')` löst auf und hat `downloadManager.downloadAndMaybeDecrypt`
- [ ] Ein Dokument aus einem Chat landet nach spätestens zwei Durchläufen in `blobs/`, `media.status`
      steht auf `done`, und ein `index_jobs`-Eintrag existiert dazu
- [ ] Ein Video wird **nicht** automatisch geholt; `media.status` steht auf `skipped` und die
      Begründung lautet „videos only on request"
- [ ] Nach dem Holen ist `logs/outgoing.log` weiterhin leer
- [ ] Die Datei ist danach im Verlauf von WhatsApp Web **nicht** als „von dir heruntergeladen"
      markiert, und der Chat wurde nicht als gelesen markiert
