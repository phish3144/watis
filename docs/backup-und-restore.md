# Sicherung und Zurückspielen

Verlangt von PLAN.md Phase 6. Zwei Dinge, die oft verwechselt werden:

|             | **Export**                                                   | **Sicherung (Backup)**         |
| ----------- | ------------------------------------------------------------ | ------------------------------ |
| Für wen     | Menschen                                                     | Maschinen                      |
| Was         | JSON, HTML, TXT pro Chat, Medien in lesbaren Ordnern         | `archive.sqlite` plus `blobs/` |
| Wozu        | lesen, weitergeben, aufheben, wenn es WatIs? nicht mehr gibt | vollständig wiederherstellen   |
| Vollständig | ja, aber ohne Suchindex                                      | ja, mit Suchindex              |

## Was „Zurückspielen" hier heißt — und was nicht

**Es gibt keinen Weg zurück nach WhatsApp.** WhatsApp bietet keine Schnittstelle an, über die sich
Nachrichten in einen Chatverlauf einspielen ließen, und dieses Projekt baut auch keine (CLAUDE.md,
„Read-only gegenüber WhatsApp"). Wer eine Sicherung zurückspielt, bekommt sie **in dieser App** zu
sehen: Archivansicht, Suche, Export. Das ist der ganze Umfang, und er ist bewusst gewählt — nicht
eine fehlende Funktion, sondern eine, die es nicht geben kann.

Konkret heißt Zurückspielen also: _das Archiv wieder lesbar machen_, auf demselben oder einem anderen
Rechner.

## Sicherung anlegen

Über die Einstellungen (**Export und Sicherung**) oder programmgesteuert. Es entstehen:

```
<Zielordner>/
  archive.sqlite     ← per VACUUM INTO, eine konsistente Datei ohne separates WAL
  blobs/             ← jede Datei, die das Archiv referenziert
  BACKUP.json        ← Bericht: Zähler, fehlende Blobs, fehlende Hashes
```

`BACKUP.json` ist der Punkt, an dem sich eine Sicherung von einem Ordner voller Dateien unterscheidet.
Er nennt, was **nicht** drin ist. Steht dort `"ok": false`, fehlt etwas — dann jetzt nachsehen, nicht
in zwei Jahren.

Ohne `blobs/` ist die Sicherung deutlich kleiner und der Text weiterhin vollständig durchsuchbar; die
Dateien selbst fehlen dann. `BACKUP.json` weist das aus.

## Zurückspielen

1. WatIs? beenden. Der Archiv-Prozess hält sonst das WAL, und eine Datei unter einem laufenden
   SQLite auszutauschen beschädigt sie.
2. `archive.sqlite` nach `%LOCALAPPDATA%\watis\archive\` kopieren.
3. `blobs/` nach `%LOCALAPPDATA%\watis\blobs\` kopieren — den Ordner **zusammenführen**, nicht
   ersetzen, wenn dort schon etwas liegt. Der Store ist inhaltsadressiert: gleiche Datei, gleicher
   Pfad, kein Konflikt.
4. WatIs? starten. Die Migrationen laufen bei Bedarf an, der Suchindex ist bereits in der Datei.

Die **Sitzung** (`session/`) gehört ausdrücklich **nicht** dazu. Sie wird nicht gesichert und nicht
zurückgespielt: auf einem anderen Rechner ist ein einmaliges Verknüpfen über den QR-Code der saubere
Weg, und eine kopierte Sitzung wäre ein Anmeldezustand an einer Stelle, an der er nicht hingehört.

## Zeitgesteuerter Export

Legt in einem festen Rhythmus lesbare Dateien in einen Ordner. Gedacht für den Fall, dass ohnehin
etwas anderes sichert — restic, rsync, ein Sync-Laufwerk. WatIs? lädt nichts hoch und kennt kein Ziel
außerhalb des eingestellten Ordners.

Der Lauf ist **inkrementell**: eine Zustandsdatei im Zielordner hält je Chat den zuletzt exportierten
Zeitstempel, der nächste Lauf hängt nur Neues an.

Der Zeitplan prüft alle paar Minuten, ob genug Zeit vergangen ist, statt einen langen Timer zu stellen.
Ein langer Timer geht bei jedem Ruhezustand daneben — und „daneben" heißt hier: eine Sicherung, die
stillschweigend nie gelaufen ist. Fehler werden festgehalten und angezeigt, nicht geschluckt.

## Prüfen, dass die Sicherung etwas taugt

Der überzeugendste Test ist der, den die DoD von Phase 6 verlangt: **Sicherung auf einem zweiten
Rechner öffnen und darin suchen.** Alles andere prüft nur, dass Dateien existieren.

Automatisiert deckt `test/integration/backup.test.ts` den Kern ab: Die Kopie öffnet eigenständig,
beantwortet eine Suche, meldet einen fehlenden Blob als fehlend statt die ganze Sicherung scheitern
zu lassen, und überschreibt einen vorherigen Lauf, statt ab dem zweiten Mal nichts mehr zu tun.
