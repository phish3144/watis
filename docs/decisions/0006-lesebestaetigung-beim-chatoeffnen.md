# ADR 0006 – Lesebestätigung als Nebenwirkung des Chat-Öffnens

- **Status:** akzeptiert
- **Datum:** 2026-08-31
- **Betrifft:** CLAUDE.md („Read-only gegenüber WhatsApp"), PLAN.md Phase 4 und 5

## Problem

Zwei verbindliche Texte des Projekts widersprachen einander, und der Widerspruch blockierte Phase 4.

CLAUDE.md verbietet unter „Read-only gegenüber WhatsApp" ausdrücklich Code, der „Nachrichten als
gelesen markiert". PLAN.md führt in §5.5 „Chat öffnen und zu einer Nachricht scrollen" als **erlaubte**
Operation, und Phase 4 baut darauf das Feature „Im WhatsApp-Chat öffnen".

Aufgefallen ist es bei der Gegenprüfung der Erweiterungs-Recherche: `WAWebCmd` exportiert
`Cmd.openChatAt(...)`, und WhatsApp Web löscht beim Öffnen eines Chats im fokussierten Fenster sichtbar
den Unread-Zähler und sendet Lesebestätigungen. Die aufgerufene Funktion schreibt nicht — aber der
Aufruf hat Schreibwirkung. Das ist genau der Unterschied, den die ursprüngliche Formulierung nicht
gemacht hat.

## Entscheidung

**Eine Lesebestätigung, die dadurch entsteht, dass ein Chat auf ausdrückliche Nutzeraktion geöffnet
wird, ist erlaubt.** Sie unterscheidet sich nicht davon, dass die Nutzerin denselben Chat von Hand
anklickt — die Software tut nichts, was die Nutzerin nicht selbst ausgelöst hat.

Verboten bleibt, was die Regel eigentlich meint: **Nachrichten als gelesen zu markieren, ohne dass ein
Mensch den Chat sehen will.** Also kein Durcharbeiten von Chats im Hintergrund, kein „alles als gelesen
markieren", kein Öffnen zum reinen Datenholen.

### Was daraus für Phase 5 folgt

Das inkrementelle Nachziehen öffnet Chats, um „ältere Nachrichten laden" auszulösen — ohne dass ein
Mensch sie lesen will. Nach der Regel oben ist das **nicht** gedeckt.

Deshalb gilt für den Backfill zusätzlich:

- Er läuft nur auf **ausdrücklichen Start** durch die Nutzerin, nie automatisch im Hintergrund.
- Die UI sagt vorher klar, dass die bearbeiteten Chats dabei als gelesen markiert werden.
- Er läuft nur bei Leerlauf, ein Chat zur Zeit, in menschlichem Tempo (§5.5 unverändert).

Damit bleibt die Nebenwirkung an eine bewusste Nutzerentscheidung gebunden, nur an eine gröbere.

## Konsequenzen

- CLAUDE.md wird präzisiert: aus „Nachrichten als gelesen markiert" wird „Nachrichten als gelesen
  markiert, ohne dass die Nutzerin den Chat öffnen wollte".
- Phase 4 kann „Im WhatsApp-Chat öffnen" bauen; das Feature-Flag aus dem Plan bleibt trotzdem, weil die
  Operation gegen undokumentierte Interna läuft und brechen kann — nicht wegen der Regel.
- `require('WAWebCmd')` liefert dasselbe Objekt, das auch `sendStarMsgs`, `sendDeleteMsgs`,
  `sendRevokeMsgs` und `Revoke` trägt. Es gibt also **keine technische Schranke** gegen Schreiboperationen,
  nur Disziplin. Der Bridge-Wrapper exportiert deshalb ausschließlich die erlaubten Aufrufe namentlich
  und reicht das rohe `Cmd`-Objekt nirgendwo weiter.
- `loadEarlierMsgs` nimmt ein Feld `trigger`, das auf `WEBC_QUERY_TRIGGER_TYPE.USER_SCROLL` defaultet.
  Automatisierter Backfill meldet sich damit an WhatsApps Telemetrie als Nutzer-Scrollen. Das wird
  bewusst so belassen — jeder andere Wert wäre eine Behauptung über die Herkunft, die wir nicht belegen
  können, und der Default ist das, was die Oberfläche selbst sendet.
