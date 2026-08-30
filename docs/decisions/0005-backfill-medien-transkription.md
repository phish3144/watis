# ADR 0005 – Backfill-Neufassung, Archivumfang und Modellwahl

- **Status:** akzeptiert
- **Datum:** 2026-08-30
- **Betrifft:** PLAN.md §1, §4 Punkt 8, Phase 4 DoD, Phase 5 vollständig, Phase 7; ADR 0001 Punkte 4, 8, 10
- **Grundlage:** [`docs/backfill-findings.md`](../backfill-findings.md), [`docs/recon.md`](../recon.md)

---

## A – Phase 5 wird ein Vorwärts-Journal

**Anlass:** WhatsApp Web liefert höchstens 90 Tage Historie. Selbst verifiziert, Beweiskette in
`docs/backfill-findings.md`. Der Massenpfad existiert für Web-Clients nicht – er wirft.

**Entscheidung:** Phase 5 wird nicht gestrichen, sondern neu gefasst. Das Archiv sammelt nicht die
Vergangenheit ein, es sorgt dafür, dass ab dem Installationstag nichts mehr verloren geht.

### Was Phase 5 jetzt ist

1. **Erstsynchronisation.** Beim Verknüpfen liefert WhatsApp seinen regulären Recent-History-Sync. Was
   ankommt, wird vollständig gespiegelt. Wie viel das ist, wird beim ersten echten Lauf gemessen und hier
   nachgetragen.
2. **Inkrementelles Nachziehen pro Chat**, bis zum harten Boden von 90 Tagen. Ein Chat gleichzeitig,
   menschliches Tempo, nur bei erreichbarem Handy, fortsetzbar nach Neustart.
3. **Die Grenze wird zur Laufzeit gelesen, nie hart kodiert.** `getEarliestHistorySyncDate()` liefert den
   Wert; die UI zeigt dem Nutzer das tatsächlich erreichbare Datum statt einer Zahl aus dem Quelltext.
   Die mautrix-Dokumentation nennt „3 Monate" statt 90 Tage – nah, aber nicht identisch, und
   änderbar.
4. **Ehrliche Fortschrittsanzeige.** Kein Balken, der bei 90 Tagen stehenbleibt und Vollständigkeit
   suggeriert. Die UI sagt, wo die Decke ist und dass sie von WhatsApp kommt, nicht von WatIs?.

### Was daraus folgt

- Der Aufwand für Phase 5 schrumpft von **M** auf **S–M**. Der Scheduler bleibt, die Tiefensteuerung
  pro Chat wird bedeutungslos und entfällt.
- **ADR 0001 Punkt 10 ist überholt.** Die Vorgabe „Default 12 Monate, pro Chat erweiterbar" beschreibt
  etwas, das es nicht gibt. `sync_state.depth_limit_ts` bleibt im Schema (es kostet nichts und erlaubt
  später eine Begrenzung nach unten), wird aber nicht als Tiefenregler beworben.
- **Die DoD von Phase 4 ändert sich.** „Eine drei Jahre alte Nachricht finden" gilt nur für Nachrichten,
  die seit der Installation aufgelaufen sind. Neue Formulierung in PLAN.md.
- Der Wert des Produkts verschiebt sich, verschwindet aber nicht. Was der offizielle Client nicht kann und
  WatIs? kann: kein 90-Tage-Fenster mehr, kein „Nutze dein Telefon für ältere Nachrichten", Volltextsuche
  über alles, Medien dauerhaft. Nur eben ab jetzt statt rückwirkend.

### Geprüft und verworfen

Die Grenze ließe sich auf ein Jahr heben, indem `gkx("4112")` gefälscht bzw.
`WAWebEnvironment.isWindows` überschrieben wird. Das ist ein **Schreibzugriff in WhatsApps Internals**
und verstößt gegen die Read-only-Regel. Es meldet dem Handy beim Verknüpfen zudem eine falsche
Plattform. Steht als verworfen im Risikoregister, damit es nicht erneut aufkommt.

### Später möglich, nicht jetzt

Für echte Tiefe gäbe es zwei Wege außerhalb der Bridge: Import von WhatsApps eigenem Chat-Export (pro
Chat, manuell) oder eines entschlüsselten Android-`msgstore.db`. Beide sind eigenständige Vorhaben und
gehören nicht in Phase 5.

---

## B – Verschwindende Nachrichten werden archiviert

**Entscheidung:** Ohne Schalter, ohne Sonderfall. Ein Archiv ist ein Archiv.

**Konsequenzen:**

- Das Datenmodell braucht keine Sonderbehandlung für befristete Nachrichten.
- **Das README sagt es ausdrücklich.** Wer verschwindende Nachrichten schickt, geht von Befristung aus;
  dass dieses Archiv sie behält, muss der Nutzer wissen und verantworten, nicht überrascht entdecken.
- **Unabhängig davon bleibt eine Korrektheitsregel:** Ein Backfill darf ein bereits gesetztes
  `revoked = 1` niemals auf 0 zurücksetzen. Sonst macht das Archiv aktiv wieder sichtbar, was ein
  Absender zurückgezogen hat – das ist kein Aufbewahren mehr, sondern Wiederherstellen. Der Upsert-Pfad
  in Phase 3 stellt das sicher, und ein Integrationstest hält es fest.

---

## C – OCR für gescannte PDFs bleibt in v1

**Entscheidung:** Bleibt drin, die Installergröße wird akzeptiert.

**Preis, gemessen:** `@napi-rs/canvas` (nativ, 27–38 MB je Plattform) für das Rendern von PDF-Seiten
ohne Textebene, plus `tesseract.js-core` (44 MB) plus deutsche Trainingsdaten. Reine
Textebenen-Extraktion über `pdfjs-dist` bräuchte davon nichts.

**Begründung:** Auf einem Firmenrechner ist der eingescannte Beleg oft genau der Fall, den man sucht.
Ein Inhaltsindex, der bei Scans aussteigt, verfehlt seinen Zweck an der Stelle, an der er am meisten
wert wäre.

**Auflage:** Die Modelldateien werden auf ein eigenes GitHub Release gespiegelt statt von einem
persönlichen HuggingFace-Konto geladen (Apache-2.0 erlaubt das ausdrücklich). Ein Konto, das umbenannt
oder gelöscht wird, würde sonst jede Neuinstallation brechen. SHA-256 wird bei jedem Download geprüft.

---

## D – Whisper: `small` als Standard, `turbo-q5_0` als Option

**Entscheidung:** Damit ist §10 Punkt 4 geschlossen.

Weil die Transkription seit ADR 0001 **on demand** läuft, zählt nicht mehr der Gesamtdurchsatz, sondern
die Wartezeit für eine einzelne Nachricht:

| Modell       | 30-Sekunden-Sprachnachricht | Rolle                                                            |
| ------------ | --------------------------- | ---------------------------------------------------------------- |
| `small`      | ~13 s                       | **Standard.** Für Deutsch ausreichend, fühlt sich interaktiv an  |
| `turbo-q5_0` | ~90 s                       | Sichtbar beworbene „genauer"-Option mit echter Wartezeit-Anzeige |
| `medium`     | –                           | Wird gar nicht angeboten                                         |

GPU-Nutzung bleibt außen vor: Sie brächte auf dem Zielrechner keinen verlässlichen Gewinn und zöge
Treiberabhängigkeiten nach, die auf einem verwalteten Gerät nicht garantiert sind.

**Auflage:** Bei `turbo-q5_0` eine Fortschrittsanzeige, kein Spinner. 90 Sekunden ohne Rückmeldung wirken
wie ein Absturz.
