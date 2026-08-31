# Bridge-Map

Jedes Modul, das die Bridge auflöst, mit der Signatur, auf die wir uns verlassen, und der WA-Web-Version,
gegen die sie zuletzt geprüft wurde. Verlangt von CLAUDE.md („Bridge-Code wird zusätzlich in
`docs/bridge-map.md` dokumentiert").

Der Sinn der Signaturen: Sie machen aus einer stillen Verhaltensänderung einen benannten Fehler beim
Start. WhatsApp liefert kontinuierlich aus — wir erfahren davon zu ihrem Zeitpunkt, nicht zu unserem.

## Der Einstieg

WA Web nutzt **kein webpack mehr**. Der Loader ist Metas eigenes `__d`-System; seine IIFE wird mit dem
globalen Objekt aufgerufen und setzt darauf `require`, `requireLazy` und `__d`. **`window.require` ist
damit ein echtes Seiten-Global** — der früher übliche `webpackChunk`-Push-Trick ist weder nötig noch
vorhanden, und `moduleRaid` entfällt.

`require()` wirft **synchron** für ein nicht registriertes Modul (`Requiring unknown module "X"`); es
lädt nichts nach und liefert kein `undefined`. Jeder Aufruf ist deshalb gekapselt — ein blinder Aufruf
würde die Exception in einem WhatsApp-Stackframe auslösen.

## Aufgelöste Module

| Modul                          | Pfad                       | Verlangt                           | Wofür                           |
| ------------------------------ | -------------------------- | ---------------------------------- | ------------------------------- |
| `WAWebChatCollection`          | `.ChatCollection`          | `get()`, `getModelsArray()`        | Chatliste, Chat-Lookup          |
| `WAWebMsgCollection`           | `.MsgCollection`           | `get()`                            | Nachrichten-Lookup              |
| `WAWebContactCollection`       | `.ContactCollection`       | `get()`, `getModelsArray()`        | Kontaktnamen                    |
| `WAWebGroupMetadataCollection` | `.GroupMetadataCollection` | `get()`                            | Gruppennamen                    |
| `WAWebChatLoadMessages`        | –                          | `loadEarlierMsgs()`                | Nachziehen (Phase 5)            |
| `WAWebCmd`                     | `.Cmd`                     | `openChatAt()`, `openChatBottom()` | Chat öffnen, zur Nachricht      |
| `WAWebHistorySyncUtils`        | –                          | `getEarliestHistorySyncDate()`     | erreichbares Datum (ADR 0005 A) |

**Pflicht** sind die ersten drei. Fällt eines davon aus, gibt es keinen Archiv-Spiegel. Alles andere ist
optional: Fehlt es, wird die zugehörige Funktion abgeschaltet und die App läuft weiter (§5.5).

## Die gefährliche Stelle

`require('WAWebCmd').Cmd` trägt **auch** `sendStarMsgs`, `sendDeleteMsgs`, `sendRevokeMsgs` und
`Revoke`. Es gibt keine technische Schranke zwischen Lesen und Schreiben.

Die Schranke ist [`src/bridge/operations.ts`](../src/bridge/operations.ts): Dort ist jeder erlaubte
Aufruf einzeln benannt, das rohe `Cmd`-Objekt verlässt das Modul nie, und ein Test hält fest, dass
genau drei Funktionen exportiert werden. **Einen schreibenden Aufruf dort zu ergänzen ist eine Änderung
an den Projektregeln, nicht an einer Datei.**

`loadEarlierMsgs` nimmt ein Feld `trigger`, das auf `WEBC_QUERY_TRIGGER_TYPE.USER_SCROLL` defaultet.
Wir setzen es **nicht**: Jeder andere Wert wäre eine Behauptung über die Herkunft der Anfrage, die wir
nicht belegen können, und der Default ist das, was die Oberfläche selbst sendet.

## Prüfstand

| Datum      | WA-Web-Version | Wie geprüft                                                              | Ergebnis                                                        |
| ---------- | -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 2026-08-31 | _(offen)_      | Modulnamen und Exporte aus dem ausgelieferten Bundle gelesen (Recherche) | plausibel, **nicht** gegen eine angemeldete Sitzung verifiziert |

> **Noch nicht bewiesen.** Die Namen stammen aus der Analyse des ausgelieferten Bundles, nicht aus einem
> Lauf mit angemeldetem Konto. Ob `ChatCollection.get()` heute liefert, was wir erwarten, zeigt erst der
> Smoke-Test aus `docs/bridge-smoke.md`. Bis dahin ist jede Zeile hier eine begründete Annahme.
>
> Der Healthcheck ist genau dafür gebaut: Er sagt beim Start, welche dieser Annahmen nicht mehr gilt,
> statt die App raten zu lassen.
