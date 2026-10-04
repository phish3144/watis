# ADR 0013 – Für alle gelöschte Nachrichten bleiben im Archiv

- **Status:** akzeptiert
- **Datum:** 2026-10-04
- **Betrifft:** PLAN.md Phase 3 (Upsert-Pfad), Phase 6 (Export), Phase 10 (Browser-Oberfläche)
- **Ändert:** [ADR 0005](0005-backfill-medien-transkription.md) B, letzter Punkt. Die Regel, dass ein
  Backfill `revoked = 1` nie zurücksetzt, bleibt. Neu ist, dass der Text dabei nicht mehr verschwindet.
- **Vorgabe der Nutzerin:** „Gelöschte Nachrichten sollen im Archiv stehen bleiben."

## Ausgangslage

Löscht jemand eine Nachricht _für alle_, liefert WhatsApp Web sie neu aus: Typ `revoked`, ohne Text,
ohne Anhang. Der Upsert übernahm das bisher. Das Archiv vergaß damit den Text, und ein Trigger nahm die
Nachricht aus dem Suchindex. Übrig blieb „Diese Nachricht wurde gelöscht."

README, Landing Page und Hilfe sagten zugleich, das Archiv behalte gelöschte Nachrichten. Für „nur für
mich gelöscht" und für verschwindende Nachrichten stimmte das, für „für alle gelöscht" nicht.

## Entscheidung

Eine Nachricht, die das Archiv schon kennt, behält beim Löschen für alle, was es von ihr hatte:

| Feld       | Bei `revoked = 1` im Upsert                                            |
| ---------- | ---------------------------------------------------------------------- |
| `body`     | bleibt, wenn die neue Fassung leer ist                                 |
| `kind`     | bleibt (eine Sprachnachricht wird nicht zu „revoked")                  |
| `media_id` | bleibt; eine schon gesicherte Datei bleibt mit der Nachricht verknüpft |
| `revoked`  | wird gesetzt und **nie** wieder auf 0 zurückgesetzt                    |
| Suchindex  | die Nachricht bleibt drin                                              |

Die Oberfläche zeigt Text und Anhang wie sonst und markiert die Nachricht mit „für alle gelöscht",
in der Chat-Ansicht, in Suchtreffern und im Export (TXT, HTML). Nur wenn das Archiv nie etwas von ihr
hatte, steht dort weiter „Diese Nachricht wurde gelöscht."

Migration 4 (`KEEP_DELETED_MESSAGES`) legt die beiden Such-Trigger ohne die Bedingung `revoked = 0`
neu an und nimmt Nachrichten, die schon als gelöscht markiert sind und noch Text haben, wieder in den
Index auf. Text, den ein älterer Stand schon geleert hatte, kommt dadurch nicht zurück.

## Grenzen

- **Nur, was vorher gespiegelt wurde.** Ist WatIs? nicht gelaufen, als die Nachricht kam, und wird sie
  gelöscht, bevor es wieder läuft, gibt es nichts zu behalten.
- **Bearbeiten bleibt Bearbeiten.** Eine bearbeitete Nachricht bekommt den neuen Text, wie bisher.
  Ältere Fassungen hebt das Archiv nicht auf.
- **Keine Wiederherstellung in WhatsApp.** Die Bridge bleibt read-only. Die Nachricht steht nur im
  lokalen Archiv, WhatsApp selbst zeigt sie weiter als gelöscht.

## Folgen für Datenschutz

Wer eine Nachricht für alle löscht, will sie zurückhaben. Dieses Archiv gibt sie nicht her. Das ist
dieselbe Abwägung wie bei verschwindenden Nachrichten (ADR 0005 B), nur deutlicher: Dort gab es eine
Frist, hier eine ausdrückliche Handlung des Absenders.

README, Landing Page und die Hilfe in der Erweiterung sagen es deshalb ausdrücklich. Wer das Archiv
führt, muss das wissen und verantworten, statt es zu entdecken. Je nach Umfeld und Rechtslage ist das
eine Entscheidung, die man bewusst trifft.

Einen Schalter dafür gibt es nicht. Eine Ausnahme, auf die sich niemand verlassen kann, ist nichts
wert. Denselben Grund nennt ADR 0005 B für verschwindende Nachrichten.

## Tests

- `test/integration/archive-repository.test.ts`, „messages deleted for everyone (ADR 0013)":
  - Text, Art und Anhang bleiben.
  - Die Nachricht bleibt auffindbar.
  - Ein Backfill setzt `revoked` nie zurück.
  - Bearbeiten ändert den Text weiter.
- `test/integration/archive-schema.test.ts`: Migration 4 nimmt markierte Nachrichten mit Text wieder in
  den Index auf.
- `test/unit/export.test.ts`: TXT und HTML behalten den Text und markieren ihn.
